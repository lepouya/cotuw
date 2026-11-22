import { TransformNode } from "@babylonjs/core";

import { stableUnit } from "./actor";
import { createViewRegistry } from "./view-registry";
import { hierarchyMeshes } from "./glb-model";

import type { DamageEffectStyle } from "../content/presentation";
import type { Scene, Vector3 } from "@babylonjs/core";
import type { ModelAsset, ModelInstance } from "./glb-model";
import type { DamageSeverity } from "./damage-stages";

export type DamageEffectProp =
  "smoke" | "fire" | "wound" | "leaf" | "fragment" | "leak";

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
  prop: Exclude<DamageEffectProp, "fire">;
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

/** Faint violet light drifting up from a damaged living core. */
const leaking = (period: number, opacity: number): Emitter => ({
  prop: "leak",
  period,
  life: 1.6,
  size: [0.25, 0.4],
  motion: {
    height: (start, progress) => start + 0.6 * progress,
    spread: () => 1,
    opacity: (progress) => Math.sin(progress * Math.PI),
  },
  start: 0.5,
  spread: 0.45,
  opacity,
});

/** Restrained moderate effects; critical ones are denser, larger, or burn. */
type DamageEffect = {
  emitters: readonly [Emitter, ...Emitter[]];
  fire?: boolean;
};
const EFFECTS: Record<
  DamageEffectStyle,
  Record<DamageSeverity, DamageEffect>
> = {
  mechanical: {
    moderate: {
      emitters: [
        {
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
      ],
    },
    critical: {
      emitters: [
        {
          prop: "smoke",
          period: 0.25,
          life: 2.8,
          size: [0.4, 1],
          motion: rising(1.8),
          start: 1,
          spread: 0.35,
          opacity: 0.8,
        },
      ],
      fire: true,
    },
  },
  living: {
    moderate: {
      emitters: [
        {
          prop: "leaf",
          period: 0.8,
          life: 1.2,
          size: [0.4, 0.4],
          motion: falling,
          start: 0.8,
          spread: 0.65,
          opacity: 1,
        },
        leaking(1.4, 0.55),
      ],
    },
    critical: {
      emitters: [
        {
          prop: "leaf",
          period: 0.3,
          life: 1.4,
          size: [0.55, 0.55],
          motion: falling,
          start: 0.85,
          spread: 0.8,
          opacity: 1,
        },
        {
          prop: "fragment",
          period: 0.45,
          life: 0.9,
          burst: { count: 2, of: 3 },
          size: [0.5, 0.5],
          motion: falling,
          start: 0.7,
          spread: 0.7,
          opacity: 1,
        },
        leaking(0.6, 0.8),
      ],
    },
  },
  biological: {
    moderate: {
      emitters: [
        {
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
      ],
    },
    critical: {
      emitters: [
        {
          prop: "wound",
          period: 0.3,
          life: 0.45,
          size: [2.8, 2.8],
          motion: falling,
          start: 0.55,
          spread: 0.5,
          opacity: 1,
        },
      ],
    },
  },
};

/** Fire scales with the actor's radius. */
const FIRE_SIZE = 0.9;

type EffectKey = {
  effect: DamageEffect;
  emissions: readonly { emitter: Emitter; asset: ModelAsset | undefined }[];
  fire: ModelAsset | undefined;
};

/**
 * Poses damage effects in real time and holds them still under reduced motion.
 */
export function createDamageEffectsView(
  scene: Scene,
  assetFor: (prop: DamageEffectProp) => ModelAsset | undefined,
  reducedMotion: () => boolean = () => false,
) {
  /** Seconds of effect time per actor, kept while severity changes. */
  const clocks = new Map<string, number>();
  const create = (
    actor: DamagedActor,
    { effect, emissions, fire }: EffectKey,
  ) => {
    const root = new TransformNode(`damage-${actor.id}`, scene);
    const instances: ModelInstance[] = [];
    const instance = (asset: ModelAsset, name: string) => {
      const made = asset.instantiate(`${root.name}-${name}`);
      made.root.parent = root;
      const meshes = hierarchyMeshes(made.root);
      for (const mesh of meshes) mesh.isPickable = false;
      instances.push(made);
      return { ...made, meshes };
    };
    const streams = emissions.flatMap(({ emitter, asset }) =>
      asset
        ? [
            {
              emitter,
              slots: Array.from(
                { length: Math.ceil(emitter.life / emitter.period) },
                (_, index) => instance(asset, `${emitter.prop}-${index}`),
              ),
            },
          ]
        : [],
    );
    const flames = fire && instance(fire, "fire");
    const [lead] = effect.emitters;
    const poseStream = (
      { emitter, slots }: (typeof streams)[number],
      { id, height, radius }: DamagedActor,
      time: number,
      reduced: boolean,
    ) => {
      const latest = Math.floor(time / emitter.period);
      const emissions = slots.map((slot, index) => {
        // Each slot shows every slots.length-th emission.
        const emission =
          latest -
          ((((latest - index) % slots.length) + slots.length) % slots.length);
        const age = time - emission * emitter.period;
        const shown =
          age < emitter.life &&
          (!emitter.burst || emission % emitter.burst.of < emitter.burst.count);
        return { slot, emission, age, shown };
      });
      // Frozen burst gaps still need a visible damage cue.
      if (
        reduced &&
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
        const seed = `${id}-${emitter.prop}-${emission}`;
        const angle = stableUnit(seed) * Math.PI * 2;
        const reach =
          Math.sqrt(stableUnit(`${seed}-reach`)) *
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
            (emitter.size[0] + (emitter.size[1] - emitter.size[0]) * progress),
        );
        const opacity = emitter.opacity * motion.opacity(progress);
        for (const mesh of slot.meshes) mesh.visibility = opacity;
      }
    };
    return {
      initialSeconds: lead.life + stableUnit(actor.id) * lead.period * 7,
      pose: (damaged: DamagedActor, time: number, reduced: boolean) => {
        root.position.copyFrom(damaged.position);
        for (const stream of streams)
          poseStream(stream, damaged, time, reduced);
        if (flames) {
          flames.root.position.set(0, damaged.height * 0.85, 0);
          flames.root.scaling.setAll(damaged.radius * FIRE_SIZE);
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
    keyFor: ({ style, severity }: DamagedActor): EffectKey => {
      const effect = EFFECTS[style][severity];
      return {
        effect,
        emissions: effect.emitters.map((emitter) => ({
          emitter,
          asset: assetFor(emitter.prop),
        })),
        fire: effect.fire ? assetFor("fire") : undefined,
      };
    },
    sameKey: (left, right) =>
      left.effect === right.effect &&
      left.emissions.every(
        ({ asset }, index) => asset === right.emissions[index]!.asset,
      ) &&
      left.fire === right.fire,
    create,
    onRemove: (id) => clocks.delete(id),
  });
  return {
    /** `frameSeconds` is real time since the last update. */
    update: (actors: readonly DamagedActor[], frameSeconds: number) => {
      views.sync(actors);
      const reduced = reducedMotion();
      for (const actor of actors) {
        const view = views.get(actor.id)!;
        // A full column shows at once, offset so actors do not pulse together.
        const seconds = clocks.get(actor.id) ?? view.initialSeconds;
        const time = reduced ? seconds : seconds + frameSeconds;
        clocks.set(actor.id, time);
        view.pose(actor, time, reduced);
      }
    },
    dispose: () => views.dispose(),
  };
}
