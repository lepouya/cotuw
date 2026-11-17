import { Color3, Mesh, VertexData } from "@babylonjs/core";

import type { Scene } from "@babylonjs/core";
import type { ServiceEffectStyle } from "../content/presentation";

/** Polylines in a unit square centered on the origin. */
export type Symbol2d = readonly (readonly (readonly [number, number])[])[];

/** An open-ended wrench, handle toward the lower left. */
export const WRENCH_SYMBOL: Symbol2d = [
  [
    [-0.75, -0.75],
    [0.2, 0.2],
    [0.65, 0.12],
    [0.95, 0.45],
  ],
  [
    [0.2, 0.2],
    [0.12, 0.65],
    [0.45, 0.95],
  ],
];

export const CROSS_SYMBOL: Symbol2d = [
  [
    [-0.7, 0],
    [0.7, 0],
  ],
  [
    [0, -0.7],
    [0, 0.7],
  ],
];

export const SERVICE_SYMBOLS: Readonly<Record<ServiceEffectStyle, Symbol2d>> = {
  medical: CROSS_SYMBOL,
  mechanical: WRENCH_SYMBOL,
};

export const SERVICE_COLORS: Readonly<Record<ServiceEffectStyle, Color3>> = {
  medical: new Color3(0.3, 1, 0.75),
  mechanical: new Color3(1, 0.72, 0.2),
};

/** A flat mesh of `width`-wide strokes in the XY plane, scaled by `size`. */
export function createSymbolMesh(
  name: string,
  symbol: Symbol2d,
  size: number,
  width: number,
  scene: Scene,
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width / size / 2;
  for (const line of symbol)
    line.slice(1).forEach(([x2, y2], index) => {
      const [x1, y1] = line[index]!;
      const length = Math.hypot(x2 - x1, y2 - y1);
      const dx = ((y2 - y1) / length) * half;
      const dy = ((x2 - x1) / length) * half;
      const offset = positions.length / 3;
      positions.push(x1 - dx, y1 + dy, 0, x1 + dx, y1 - dy, 0);
      positions.push(x2 + dx, y2 - dy, 0, x2 - dx, y2 + dy, 0);
      indices.push(offset, offset + 1, offset + 2);
      indices.push(offset, offset + 2, offset + 3);
    });
  const mesh = new Mesh(name, scene);
  const vertices = new VertexData();
  vertices.positions = positions.map((value) => value * size);
  vertices.indices = indices;
  vertices.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}
