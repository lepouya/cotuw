import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
import { groundCross, groundPoint, groundRing } from "./ground-marker";

import type { LinesMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { AttackEvent } from "../simulation/combat";
import type { WorldPosition } from "../simulation/world";

/** How an attacker's hits are drawn. */
export type AttackEffectStyle = "tracer" | "bite";

const LIFETIMES: Record<AttackEffectStyle | "target", number> = {
  tracer: 0.12,
  bite: 0.3,
  target: 0.6,
};
const MUZZLE_HEIGHT = 1.2;
const HIT_HEIGHT = 0.6;
const TRACER_COLOR = new Color3(1, 0.92, 0.55);
const BITE_COLOR = new Color3(1, 0.3, 0.22);
const TARGET_COLOR = new Color3(0.95, 0.18, 0.15);

/** Short-lived, presentation-only shot, strike, and attack-order markers. */
export function createCombatEffectsView(scene: Scene, map: TerrainMap) {
  const effects: { mesh: LinesMesh; expires: number; life: number }[] = [];
  let now = 0;
  const add = (mesh: LinesMesh, color: Color3, life: number) => {
    mesh.color = color;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    effects.push({ mesh, expires: now + life, life });
  };
  const above = (point: Readonly<WorldPosition>, height: number) =>
    groundPoint(map, point, height);
  return {
    /** Draws a hit; `style` comes from the attacker's presentation. */
    hit: (event: AttackEvent, style: AttackEffectStyle) => {
      if (style === "tracer") {
        const from = above(event.from, MUZZLE_HEIGHT);
        const to = above(event.to, HIT_HEIGHT);
        // Starts at the muzzle rather than the shooter's center.
        const start = from.add(to.subtract(from).normalize().scale(0.35));
        add(
          MeshBuilder.CreateLines("tracer", { points: [start, to] }, scene),
          TRACER_COLOR,
          LIFETIMES.tracer,
        );
        return;
      }
      const center = above(event.to, HIT_HEIGHT);
      const direction = new Vector3(
        event.to.x - event.from.x,
        0,
        event.to.z - event.from.z,
      ).normalize();
      const side = new Vector3(direction.z, 0, -direction.x);
      // Three slanted claw marks across the strike direction.
      const lines = [-1, 0, 1].map((offset) => {
        const middle = center.add(side.scale(offset * 0.12));
        return [
          middle.add(new Vector3(0, 0.22, 0)).add(side.scale(0.12)),
          middle.add(new Vector3(0, -0.22, 0)).subtract(side.scale(0.12)),
        ];
      });
      add(
        MeshBuilder.CreateLineSystem("bite", { lines }, scene),
        BITE_COLOR,
        LIFETIMES.bite,
      );
    },
    /** Acknowledges an accepted attack order at its target. */
    markTarget: (point: Readonly<WorldPosition>) => {
      const sample = (ground: Readonly<WorldPosition>) =>
        groundPoint(map, ground, 0.12);
      add(
        MeshBuilder.CreateLineSystem(
          "attack-target",
          {
            lines: [
              groundRing(point, 0.7, 32, sample),
              ...groundCross(point, 0.5, sample),
            ],
          },
          scene,
        ),
        TARGET_COLOR,
        LIFETIMES.target,
      );
    },
    /** Advances effect lifetimes by real, not simulated, time. */
    update: (seconds: number) => {
      now += seconds;
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index]!;
        const remaining = effect.expires - now;
        if (remaining <= 0) {
          effect.mesh.dispose();
          effects.splice(index, 1);
        } else {
          effect.mesh.alpha = Math.min(1, (remaining / effect.life) * 2);
        }
      }
    },
    dispose: () => {
      for (const { mesh } of effects) mesh.dispose();
      effects.length = 0;
    },
  };
}
