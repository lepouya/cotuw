import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";

import { tileBounds } from "../simulation/grid";
import { groundPoint } from "./ground-marker";
import { aboveTerrainLayers } from "./terrain-mesh";

import type { Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorDefinition } from "../simulation/actor";
import type { ObservedActor } from "../simulation/owner-view";
import type { WorldPosition } from "../simulation/world";

const RIM = Array.from({ length: 12 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 12;
  return { x: Math.cos(angle), z: Math.sin(angle) };
});
const VERTICES_PER_SHADOW = 1 + RIM.length * 2;
const RINGS = [0.58, 1];

/** Batches soft, terrain-hugging shadows for actors the player can see. */
export function createContactShadows(
  scene: Scene,
  map: TerrainMap,
  definitions: readonly ActorDefinition[],
  sunDirection: Readonly<WorldPosition>,
) {
  const material = new StandardMaterial("contact-shadow", scene);
  material.emissiveColor = new Color3(0.025, 0.034, 0.04);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  const mesh = new Mesh("contact-shadows", scene);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.hasVertexAlpha = true;
  // Above terrain textures and below the fog.
  mesh.alphaIndex = 999;
  mesh.setEnabled(false);

  const sizes = new Map(
    definitions.map(({ id, footprint, movement }) => {
      if (!footprint) {
        const radius = (movement?.radius ?? 0.28) * 1.55;
        return [id, { x: radius, z: radius }] as const;
      }
      const { minX, maxX, minZ, maxZ } = tileBounds(footprint.occupiedTiles);
      return [
        id,
        {
          x: (maxX - minX + 1.55) * map.tileSize * 0.58,
          z: (maxZ - minZ + 1.55) * map.tileSize * 0.58,
        },
      ] as const;
    }),
  );
  let offset = aboveTerrainLayers(map, 0.008);
  let terrainDirty = false;
  const terrainObserver = map.onChangedObservable.add(() => {
    terrainDirty = true;
  });
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  // Each caster contributes its center x/z followed by its x/z radii.
  let previous: number[] = [];
  let next: number[] = [];

  return {
    update: (
      actors: readonly ObservedActor[],
      renderedPosition: (id: string) => WorldPosition | undefined,
    ) => {
      next.length = 0;
      for (const actor of actors) {
        if (actor.occupancyLayer !== "surface") continue;
        const size = sizes.get(actor.definitionId);
        if (!size) continue;
        const placement = actor.tilePlacement;
        const point = placement
          ? actor.worldPosition
          : renderedPosition(actor.id);
        if (!point) continue;
        const swapAxes = placement && placement.quarterTurns % 2 === 1;
        const xRadius = swapAxes ? size.z : size.x;
        const zRadius = swapAxes ? size.x : size.z;
        const spread = placement ? 0.27 : 0.12;
        next.push(
          point.x + sunDirection.x * spread,
          point.z + sunDirection.z * spread,
          xRadius,
          zRadius,
        );
      }
      if (terrainDirty) offset = aboveTerrainLayers(map, 0.008);
      else if (
        previous.length === next.length &&
        previous.every((value, index) => value === next[index])
      )
        return;
      terrainDirty = false;
      [previous, next] = [next, previous];
      mesh.setEnabled(previous.length > 0);
      if (!previous.length) return;

      positions.length = 0;
      for (let i = 0; i < previous.length; i += 4) {
        const x = previous[i]!;
        const z = previous[i + 1]!;
        const xRadius = previous[i + 2]!;
        const zRadius = previous[i + 3]!;
        const center = groundPoint(map, { x, z }, offset);
        positions.push(center.x, center.y, center.z);
        for (const ring of RINGS) {
          for (const direction of RIM) {
            const point = groundPoint(
              map,
              {
                x: x + direction.x * xRadius * ring,
                z: z + direction.z * zRadius * ring,
              },
              offset,
            );
            positions.push(point.x, point.y, point.z);
          }
        }
      }

      const vertices = positions.length / 3;
      if (vertices === mesh.getTotalVertices()) {
        mesh.updateVerticesData("position", positions, true);
        return;
      }
      indices.length = 0;
      colors.length = 0;
      for (let center = 0; center < vertices; center += VERTICES_PER_SHADOW) {
        colors.push(1, 1, 1, 0.55);
        for (const ring of RINGS)
          for (let step = 0; step < RIM.length; step++)
            colors.push(1, 1, 1, ring === 1 ? 0 : 0.42);
        for (let step = 0; step < RIM.length; step++) {
          const inner = center + 1 + step;
          const nextInner = center + 1 + ((step + 1) % RIM.length);
          const outer = inner + RIM.length;
          const nextOuter = nextInner + RIM.length;
          indices.push(center, inner, nextInner, inner, outer, nextOuter);
          indices.push(inner, nextOuter, nextInner);
        }
      }
      const data = new VertexData();
      data.positions = positions;
      data.indices = indices;
      data.colors = colors;
      data.applyToMesh(mesh, true);
    },
    dispose: () => {
      map.onChangedObservable.remove(terrainObserver);
      mesh.dispose();
      material.dispose();
    },
  };
}
