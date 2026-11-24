import {
  Color3,
  Matrix,
  MeshBuilder,
  Quaternion,
  Vector3,
} from "@babylonjs/core";
import {
  BAR_HEIGHT,
  BAR_RENDERING_GROUP,
  BORDER,
  createBarMaterial,
  fillSpan,
} from "./screen-bar";

import type { Mesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";

const SEGMENTS = 5;
const DIVIDER_WIDTH = 0.025;
const FRAME_COLOR = new Color3(0.04, 0.05, 0.05);
const HEALTHY = new Color3(0.3, 0.86, 0.38);
const WOUNDED = new Color3(0.98, 0.74, 0.18);
const CRITICAL = new Color3(0.94, 0.24, 0.2);
const fillColor = (fraction: number) => {
  if (fraction > 0.6) return HEALTHY;
  return fraction > 0.3 ? WOUNDED : CRITICAL;
};
/** Unselected actors show bars this long after combat, then fade out. */
const COMBAT_SECONDS = 3;
const FADE_SECONDS = 1;
/** Building health bars sit this far above the ground. */
export const BUILDING_BAR_HEIGHT = 2.9;

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

/** Instance data for one of the bars' shared meshes, grown as needed. */
type BarLayer = {
  mesh: Mesh;
  matrices: Float32Array;
  colors: Float32Array;
  count: number;
  /** The array the mesh's matrix buffer wraps. */
  published?: Float32Array;
};

/**
 * Five-segment bars above actors. The fill drains continuously; dividers mark
 * 20% steps, and its color changes at 60% and 30% so length and color agree.
 * Every bar shares three thin-instanced meshes, so bars cost three draw calls
 * however many show. Each faces the camera, as screen bars do.
 */
export function createHealthBarView(scene: Scene, map: TerrainMap) {
  // White emission lets each instance's color become its final color.
  const material = createBarMaterial(scene, "health-bars", Color3.White());
  // A unit square that each instance scales to its part's size.
  const layer = (name: string, alphaIndex: number, depth: number): BarLayer => {
    const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    // Slightly towards the camera, which billboards face along -Z.
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0, depth));
    mesh.material = material;
    mesh.isPickable = false;
    mesh.renderingGroupId = BAR_RENDERING_GROUP;
    mesh.alphaIndex = alphaIndex;
    mesh.hasVertexAlpha = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isVisible = false;
    return {
      mesh,
      matrices: new Float32Array(0),
      colors: new Float32Array(0),
      count: 0,
    };
  };
  const frames = layer("health-bar-frames", 0, 0);
  const fills = layer("health-bar-fills", 1, -0.001);
  const dividers = layer("health-bar-dividers", 2, -0.002);
  const layers = [frames, fills, dividers];
  let entries: readonly HealthBar[] = [];
  frames.mesh.metadata = {
    frameFor(actorId: string) {
      const index = entries.findIndex((entry) => entry.actorId === actorId);
      // Babylon caches its own thin-instance matrix snapshots.
      return index < 0
        ? undefined
        : Matrix.FromArray(frames.matrices, index * 16);
    },
  };
  const facing = new Quaternion();
  const rotation = new Matrix();
  const local = new Matrix();
  const placed = new Matrix();
  const world = new Matrix();
  const position = new Vector3();
  const add = (
    target: BarLayer,
    width: number,
    height: number,
    x: number,
    color: Color3,
    opacity: number,
  ) => {
    Matrix.ScalingToRef(width, height, 1, local);
    local.setTranslationFromFloats(x, 0, 0);
    local.multiplyToRef(placed, world);
    const index = target.count++;
    world.copyToArray(target.matrices, index * 16);
    const channel = index * 4;
    target.colors[channel] = color.r;
    target.colors[channel + 1] = color.g;
    target.colors[channel + 2] = color.b;
    target.colors[channel + 3] = opacity;
  };
  const reserve = (target: BarLayer, count: number) => {
    if (target.matrices.length >= count * 16) return;
    const capacity = Math.max(count, (target.matrices.length / 16) * 2);
    target.matrices = new Float32Array(capacity * 16);
    target.colors = new Float32Array(capacity * 4);
  };
  const publish = (target: BarLayer) => {
    const { mesh } = target;
    mesh.isVisible = target.count > 0;
    if (target.count === 0) {
      mesh.thinInstanceCount = 0;
      return;
    }
    if (target.published !== target.matrices) {
      mesh.thinInstanceSetBuffer("matrix", target.matrices, 16, false);
      mesh.thinInstanceSetBuffer("color", target.colors, 4, false);
      target.published = target.matrices;
      mesh.thinInstanceCount = target.count;
    } else {
      // Babylon uploads only the matrices up to the current instance count.
      mesh.thinInstanceCount = target.count;
      mesh.thinInstanceBufferUpdated("matrix");
      mesh.thinInstanceBufferUpdated("color");
    }
  };
  return {
    /** Shows exactly these bars. */
    update: (bars: readonly HealthBar[]) => {
      entries = bars;
      const camera = scene.activeCamera;
      if (camera && entries.length) {
        camera.getWorldMatrix().getRotationMatrixToRef(rotation);
        Quaternion.FromRotationMatrixToRef(rotation, facing);
      }
      reserve(frames, entries.length);
      reserve(fills, entries.length);
      reserve(dividers, entries.length * (SEGMENTS - 1));
      for (const target of layers) target.count = 0;
      for (const {
        worldPosition,
        height,
        width,
        fraction,
        opacity,
      } of entries) {
        const { x, z } = worldPosition;
        Matrix.ComposeToRef(
          Vector3.OneReadOnly,
          facing,
          position.set(x, map.heightAtWorldPosition(x, z) + height, z),
          placed,
        );
        add(
          frames,
          width + BORDER * 2,
          BAR_HEIGHT + BORDER * 2,
          0,
          FRAME_COLOR,
          opacity,
        );
        const fill = fillSpan(fraction, width);
        add(
          fills,
          fill.scale * width,
          BAR_HEIGHT,
          fill.x,
          fillColor(fill.fraction),
          opacity,
        );
        for (let index = 1; index < SEGMENTS; index += 1)
          add(
            dividers,
            DIVIDER_WIDTH,
            BAR_HEIGHT,
            (index / SEGMENTS - 0.5) * width,
            FRAME_COLOR,
            opacity,
          );
      }
      for (const target of layers) publish(target);
    },
    dispose: () => {
      for (const { mesh } of layers) mesh.dispose();
      material.dispose();
    },
  };
}
