import { modelPartName } from "./glb-model";
import type { TransformNode } from "@babylonjs/core";

export type DamageSeverity = "moderate" | "critical";

/** Health fractions at or below which damage shows. */
const MODERATE_DAMAGE = 0.6;
const CRITICAL_DAMAGE = 0.3;

export function damageSeverity(fraction: number): DamageSeverity | undefined {
  if (fraction <= CRITICAL_DAMAGE) return "critical";
  if (fraction <= MODERATE_DAMAGE) return "moderate";
  return undefined;
}

export function actorDamage(
  health: number | undefined,
  maximum: number | undefined,
): DamageSeverity | undefined {
  return maximum && health !== undefined
    ? damageSeverity(health / maximum)
    : undefined;
}

/** Flicker steps per second for a critically damaged core. */
const FLICKER_RATE = 9;

/** A stepped, irregular brightness from 0.25 to 1. */
function flickerLevel(seconds: number): number {
  const step = Math.floor(seconds * FLICKER_RATE);
  const noise = Math.sin(step * 12.9898) * 43758.5453;
  return 0.25 + 0.75 * (noise - Math.floor(noise));
}

/**
 * Shows a model's authored `damage-moderate` meshes at moderate or critical
 * damage and `damage-critical` meshes at critical damage. Critical
 * `flicker` meshes vary in brightness unless motion is reduced.
 */
export function createDamageStages(root: TransformNode) {
  const meshes = root.getChildMeshes();
  const named = (stage: string) =>
    meshes.filter((mesh) => modelPartName(root, mesh).includes(stage));
  const moderate = named("damage-moderate");
  const critical = named("damage-critical");
  const flickering = critical.filter((mesh) =>
    modelPartName(root, mesh).includes("flicker"),
  );
  const lights = named("fading-light");
  let shown: DamageSeverity | undefined;
  let settled = false;
  for (const mesh of [...moderate, ...critical]) mesh.setEnabled(false);
  const show = (severity: DamageSeverity | undefined) => {
    if (settled || severity === shown) return;
    shown = severity;
    for (const mesh of moderate) mesh.setEnabled(severity !== undefined);
    for (const mesh of critical) mesh.setEnabled(severity === "critical");
  };
  return {
    show,
    animate: (seconds: number, reducedMotion: boolean) => {
      if (settled || shown !== "critical") return;
      const level = reducedMotion ? 1 : flickerLevel(seconds);
      for (const mesh of flickering) mesh.visibility = level;
    },
    /** Remains keep their broken shapes with the light gone out. */
    settle: () => {
      if (settled) return;
      show("critical");
      settled = true;
      for (const mesh of lights) mesh.setEnabled(false);
      for (const mesh of flickering) mesh.setEnabled(false);
    },
  };
}
