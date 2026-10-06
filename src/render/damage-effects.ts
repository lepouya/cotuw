import { TransformNode } from "@babylonjs/core";

import { stableUnit } from "./actor";
import { createViewRegistry } from "./view-registry";
import { hierarchyMeshes } from "./glb-model";

import type { Scene, Vector3 } from "@babylonjs/core";
import type { ModelAsset, ModelInstance } from "./glb-model";

export const DAMAGE_EFFECT_STYLES = ["mechanical", "biological"] as const;
export type DamageEffectStyle = (typeof DAMAGE_EFFECT_STYLES)[number];
export type DamageSeverity = "moderate" | "critical";
export type DamageEffectProp = "smoke" | "fire" | "wound";

/** Health fractions at or below which damage shows. */
const MODERATE_DAMAGE = 0.6;
const CRITICAL_DAMAGE = 0.3;

export function damageSeverity(fraction: number): DamageSeverity | undefined {
  if (fraction <= CRITICAL_DAMAGE) return "critical";
  if (fraction <= MODERATE_DAMAGE) return "moderate";
  return undefined;
}

export type DamagedActor = {
  /** The damaged actor's ID. */
  id: string;
  style: DamageEffectStyle;
  severity: DamageSeverity;
  /** The ground point under the actor's center. */
  position: Vector3;
  /** The actor's top above `position`. */
  height: number;
  /** Horizontal half-extent that scales and spreads the effect. */
  radius: number;
};

/** How an emission moves and fades as its life progresses from 0 to 1. */
type EmissionMotion = {
  /** Height above the ground point, from the height it starts at. */
  height: (start: number, progress: number) => number;
  /** Multiplies the emission's distance from the actor's center. */
  spread: (progress: number) => number;
  opacity: (progress: number) => number;
};

/** Smoke rises `distance`, widening; it fades in quickly and then thins. */
const rising = (distance: number): EmissionMotion => ({
  height: (start, progress) => start + distance * progress,
  spread: (progress) => 1 + progress,
  opacity: (progress) => Math.min(1, progress * 6) * (1 - progress),
});

/** Drops fall from where they start and land at the end of their life. */
const falling: EmissionMotion = {
  height: (start, progress) => start * (1 - progress * progress),
  spread: () => 1,
  opacity: () => 1,
};

/** Repeating emissions of one prop; each is a pure function of time. */
type Emitter = {
  prop: "smoke" | "wound";
  /** Seconds between emissions. */
  period: number;
  /** Seconds each emission stays visible. */
  life: number;
  /** Shows the first `count` of every `of` emissions, so effects pulse. */
  burst?: { count: number; of: number };
  /** Size as a multiple of the actor's radius, at birth and at the end. */
  size: readonly [number, number];
  motion: EmissionMotion;
  /** Fraction of the actor's height where emissions start. */
  start: number;
  spread: number;
  opacity: number;
};

/** Restrained moderate effects; critical ones are denser, larger, or burn. */
const EFFECTS: Record<
  DamageEffectStyle,
  Record<DamageSeverity, { emitter: Emitter; fire?: boolean }>
> = {
  mechanical: {
    moderate: {
      emitter: {
        prop: "smoke",
        period: 0.45,
        life: 2.2,
        burst: { count: 3, of: 9 },
        size: [0.3, 0.6],
        motion: rising(1.1),
        start: 0.9,
        spread: 0.3,
        opacity: 0.55,
      },
    },
    critical: {
      emitter: {
        prop: "smoke",
        period: 0.25,
        life: 2.8,
        size: [0.4, 1],
        motion: rising(1.8),
        start: 1,
        spread: 0.35,
        opacity: 0.8,
      },
      fire: true,
    },
  },
  biological: {
    moderate: {
      emitter: {
        prop: "wound",
        period: 0.7,
        life: 0.45,
        burst: { count: 1, of: 3 },
        size: [2.2, 2.2],
        motion: falling,
        start: 0.55,
        spread: 0.4,
        opacity: 1,
      },
    },
    critical: {
      emitter: {
        prop: "wound",
        period: 0.3,
        life: 0.45,
        size: [2.8, 2.8],
        motion: falling,
        start: 0.55,
        spread: 0.5,
        opacity: 1,
      },
    },
  },
};

/** Fire scales with the actor's radius. */
const FIRE_SIZE = 0.9;

type EffectKey = {
  style: DamageEffectStyle;
  severity: DamageSeverity;
  emission: ModelAsset | undefined;
  fire: ModelAsset | undefined;
};

/**
 * Presentation-only smoke, fire, and wound drops over damaged actors. Effects
 * follow real time and hold still when motion is reduced.
 */
export function createDamageEffectsView(
  scene: Scene,
  assetFor: (prop: DamageEffectProp) => ModelAsset | undefined,
  reducedMotion: () => boolean = () => false,
) {
  /** Seconds of effect time per actor, kept while severity changes. */
  const clocks = new Map<string, number>();
  const create = (actor: DamagedActor, assets: EffectKey) => {
    const { emitter, fire } = EFFECTS[actor.style][actor.severity];
    const root = new TransformNode(`damage-${actor.id}`, scene);
    const instances: ModelInstance[] = [];
    const instance = (asset: ModelAsset | undefined, name: string) => {
      const made = asset?.instantiate(`${root.name}-${name}`);
      if (!made) return undefined;
      made.root.parent = root;
      const meshes = hierarchyMeshes(made.root);
      for (const mesh of meshes) mesh.isPickable = false;
      instances.push(made);
      return { ...made, meshes };
    };
    const slots = Array.from(
      { length: Math.ceil(emitter.life / emitter.period) },
      (_, index) => instance(assets.emission, `${emitter.prop}-${index}`),
    ).filter((slot) => slot !== undefined);
    const flames = fire ? instance(assets.fire, "fire") : undefined;
    return {
      pose: ({ id, position, height, radius }: DamagedActor, time: number) => {
        root.position.copyFrom(position);
        const latest = Math.floor(time / emitter.period);
        const emissions = slots.map((slot, index) => {
          // Each slot shows every slots.length-th emission.
          const emission =
            latest -
            ((((latest - index) % slots.length) + slots.length) % slots.length);
          const age = time - emission * emitter.period;
          const shown =
            age < emitter.life &&
            (!emitter.burst ||
              emission % emitter.burst.of < emitter.burst.count);
          return { slot, emission, age, shown };
        });
        // Frozen burst gaps still need a visible damage cue.
        if (
          reducedMotion() &&
          emissions.length > 0 &&
          !emissions.some(
            ({ shown, age }) =>
              shown && emitter.motion.opacity(age / emitter.life) > 0,
          )
        ) {
          emissions[0]!.shown = true;
          emissions[0]!.age = emitter.life / 2;
        }
        for (const { slot, emission, age, shown } of emissions) {
          slot.root.setEnabled(shown);
          if (!shown) continue;
          const { motion } = emitter;
          const progress = age / emitter.life;
          const angle = stableUnit(`${id}-${emission}`) * Math.PI * 2;
          const reach =
            Math.sqrt(stableUnit(`${id}-${emission}-reach`)) *
            emitter.spread *
            radius *
            motion.spread(progress);
          slot.root.position.set(
            Math.sin(angle) * reach,
            motion.height(height * emitter.start, progress),
            Math.cos(angle) * reach,
          );
          slot.root.scaling.setAll(
            radius *
              (emitter.size[0] +
                (emitter.size[1] - emitter.size[0]) * progress),
          );
          const opacity = emitter.opacity * motion.opacity(progress);
          for (const mesh of slot.meshes) mesh.visibility = opacity;
        }
        if (flames) {
          flames.root.position.set(0, height * 0.85, 0);
          flames.root.scaling.setAll(radius * FIRE_SIZE);
          flames.pose(time);
        }
      },
      dispose: () => {
        for (const made of instances) made.dispose();
        root.dispose();
      },
    };
  };
  // Props that load later rebuild the views that use them.
  const views = createViewRegistry({
    keyFor: ({ style, severity }: DamagedActor) => {
      const { emitter, fire } = EFFECTS[style][severity];
      return {
        style,
        severity,
        emission: assetFor(emitter.prop),
        fire: fire ? assetFor("fire") : undefined,
      };
    },
    sameKey: (left, right) =>
      left.style === right.style &&
      left.severity === right.severity &&
      left.emission === right.emission &&
      left.fire === right.fire,
    create,
    onRemove: (id) => clocks.delete(id),
  });
  return {
    /** `frameSeconds` is real time since the last update. */
    update: (actors: readonly DamagedActor[], frameSeconds: number) => {
      views.sync(actors);
      for (const actor of actors) {
        const { emitter } = EFFECTS[actor.style][actor.severity];
        // A full column shows at once, offset so actors do not pulse together.
        const seconds =
          clocks.get(actor.id) ??
          emitter.life + stableUnit(actor.id) * emitter.period * 7;
        const time = reducedMotion() ? seconds : seconds + frameSeconds;
        clocks.set(actor.id, time);
        views.get(actor.id)!.pose(actor, time);
      }
    },
    dispose: () => views.dispose(),
  };
}
