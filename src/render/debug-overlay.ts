import {
  Color3,
  Mesh,
  MeshBuilder,
  type Observer,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { TerrainMap } from "../map";

const GRID_OFFSET = 0.035;

export type GridStyle = {
  name: string;
  /** Tiles between lines. */
  interval: number;
  color: Color3;
};

export type DebugOverlayOptions = {
  layerOffset: number;
  grids?: GridStyle[];
  boundaryColor?: Color3;
};

export type DebugOverlay = {
  dispose: () => void;
};

/** Draws grid and map-boundary lines above the terrain for debugging. */
export function createDebugOverlay(
  scene: Scene,
  map: TerrainMap,
  {
    layerOffset,
    grids = [
      { name: "tile-grid", interval: 1, color: new Color3(0.12, 0.26, 0.27) },
      { name: "major-grid", interval: 10, color: new Color3(0.76, 0.59, 0.27) },
    ],
    boundaryColor = new Color3(0.95, 0.78, 0.35),
  }: DebugOverlayOptions,
): DebugOverlay {
  for (const { interval } of grids) {
    if (!Number.isInteger(interval) || interval < 1) {
      throw new RangeError("Grid intervals must be positive whole tiles.");
    }
  }

  let meshes: Mesh[] = [];
  const refresh = () => {
    for (const mesh of meshes) {
      mesh.dispose();
    }
    meshes = [];

    const heightOffset = map.layerCount * layerOffset + GRID_OFFSET;
    for (const grid of grids) {
      meshes.push(createGrid(scene, map, grid, heightOffset));
    }
    meshes.push(createMapBoundary(scene, map, boundaryColor, heightOffset));
  };

  let refreshObserver: Observer<Scene> | undefined;
  let disposed = false;
  const changeObserver = map.onChangedObservable.add(() => {
    if (!refreshObserver) {
      refreshObserver = scene.onBeforeRenderObservable.addOnce(() => {
        refresh();
        refreshObserver = undefined;
      });
    }
  });
  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    map.onChangedObservable.remove(changeObserver);
    if (refreshObserver) {
      scene.onBeforeRenderObservable.remove(refreshObserver);
    }
    scene.onDisposeObservable.remove(sceneDisposeObserver);
    for (const mesh of meshes) {
      mesh.dispose();
    }
    meshes = [];
  };
  const sceneDisposeObserver = scene.onDisposeObservable.add(dispose);

  refresh();
  return { dispose };
}

function createGrid(
  scene: Scene,
  map: TerrainMap,
  { name, interval, color }: GridStyle,
  heightOffset: number,
): Mesh {
  const lines: Vector3[][] = [];

  for (let z = 0; z <= map.height; z += interval) {
    const row: Vector3[] = [];

    for (let x = 0; x <= map.width; x += 1) {
      row.push(map.cornerPoint(x, z, heightOffset));
    }

    lines.push(row);
  }

  for (let x = 0; x <= map.width; x += interval) {
    const column: Vector3[] = [];

    for (let z = 0; z <= map.height; z += 1) {
      column.push(map.cornerPoint(x, z, heightOffset));
    }

    lines.push(column);
  }

  const grid = MeshBuilder.CreateLineSystem(name, { lines }, scene);
  grid.color = color;
  return grid;
}

function createMapBoundary(
  scene: Scene,
  map: TerrainMap,
  color: Color3,
  heightOffset: number,
): Mesh {
  const boundary = MeshBuilder.CreateLines(
    "map-boundary",
    {
      points: [
        map.cornerPoint(0, 0, heightOffset),
        map.cornerPoint(map.width, 0, heightOffset),
        map.cornerPoint(map.width, map.height, heightOffset),
        map.cornerPoint(0, map.height, heightOffset),
        map.cornerPoint(0, 0, heightOffset),
      ],
    },
    scene,
  );
  boundary.color = color;
  return boundary;
}
