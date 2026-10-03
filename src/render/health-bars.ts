import { Color3 } from "@babylonjs/core";
import { createBarMaterial, createScreenBar } from "./screen-bar";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";
import type { ScreenBar } from "./screen-bar";

const SEGMENTS = 5;
/** Unselected actors show bars this long after combat, then fade out. */
const COMBAT_SECONDS = 3;
const FADE_SECONDS = 1;

/** Selected actors always show a bar; others only during and after combat. */
export function healthBarOpacity(
  selected: boolean,
  secondsSinceCombat: number,
): number {
  if (selected) return 1;
  return Math.min(
    1,
    Math.max(
      0,
      (COMBAT_SECONDS + FADE_SECONDS - secondsSinceCombat) / FADE_SECONDS,
    ),
  );
}

export type HealthBar = {
  actorId: string;
  worldPosition: Readonly<WorldPosition>;
  /** Height of the bar's center above the ground. */
  height: number;
  width: number;
  /** Current over maximum health, from 0 to 1. */
  fraction: number;
  /** Fades the whole bar, from 0 to 1. */
  opacity: number;
};

/**
 * Five-segment bars above actors. The fill drains continuously; dividers mark
 * 20% steps, and its color changes at 60% and 30% so length and color agree.
 */
export function createHealthBarView(scene: Scene, map: TerrainMap) {
  const material = (name: string, color: Color3) =>
    createBarMaterial(scene, `health-bar-${name}`, color);
  const frame = material("frame", new Color3(0.04, 0.05, 0.05));
  const healthy = material("healthy", new Color3(0.3, 0.86, 0.38));
  const wounded = material("wounded", new Color3(0.98, 0.74, 0.18));
  const critical = material("critical", new Color3(0.94, 0.24, 0.2));
  const bars = new Map<string, { bar: ScreenBar; width: number }>();
  return {
    /** Shows exactly these bars; others are removed. */
    update: (entries: readonly HealthBar[]) => {
      const present = new Set(entries.map(({ actorId }) => actorId));
      for (const [id, { bar }] of bars) {
        if (present.has(id)) continue;
        bar.dispose();
        bars.delete(id);
      }
      for (const entry of entries) {
        let view = bars.get(entry.actorId);
        if (view && view.width !== entry.width) {
          view.bar.dispose();
          view = undefined;
        }
        if (!view) {
          view = {
            bar: createScreenBar(scene, `health-bar-${entry.actorId}`, {
              width: entry.width,
              frame,
              segments: SEGMENTS,
            }),
            width: entry.width,
          };
          bars.set(entry.actorId, view);
        }
        const { bar } = view;
        const { x, z } = entry.worldPosition;
        bar.root.position.set(
          x,
          map.heightAtWorldPosition(x, z) + entry.height,
          z,
        );
        bar.setFill(
          entry.fraction,
          entry.fraction > 0.6
            ? healthy
            : entry.fraction > 0.3
              ? wounded
              : critical,
        );
        for (const mesh of bar.meshes) mesh.visibility = entry.opacity;
      }
    },
    dispose: () => {
      for (const { bar } of bars.values()) bar.dispose();
      bars.clear();
      for (const item of [frame, healthy, wounded, critical]) item.dispose();
    },
  };
}
