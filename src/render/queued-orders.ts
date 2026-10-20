import { Color4, MeshBuilder } from "@babylonjs/core";

import { groundCross, groundPoint, groundRing } from "./ground-marker";
import { aboveTerrainLayers } from "./terrain-mesh";
import { distance } from "../simulation/world";

import type { LinesMesh, Scene, Vector3 } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { ActorRenderState, QueuedOrder } from "../simulation/actor";
import type { WorldPosition } from "../simulation/world";

const ORDER_COLORS: Record<QueuedOrder["kind"], Color4> = {
  move: new Color4(1, 0.78, 0.24, 0.85),
  "attack-move": new Color4(1, 0.42, 0.12, 0.85),
  attack: new Color4(1, 0.25, 0.17, 0.85),
  gather: new Color4(0.3, 0.8, 0.85, 0.85),
};
const DASH_LENGTH = 0.3;
const DASH_PERIOD = 0.6;
const MARKER_RADIUS = 0.32;
const MARKER_SEGMENTS = 20;
const MARKER_OFFSET = 0.045;

/**
 * Draws dashed legs from each actor's current goal through its queued orders.
 * Rings mark destinations, crosses attack targets, and diamonds Gather sites.
 */
export function createQueuedOrderView(
  scene: Scene,
  map: TerrainMap,
  /** Where an order leads; undefined hides orders such as unseen targets. */
  pointOf: (order: QueuedOrder) => Readonly<WorldPosition> | undefined,
) {
  let mesh: LinesMesh | undefined;
  let drawn = "";
  let disposed = false;
  const terrainObserver = map.onChangedObservable.add(() => {
    drawn = "";
  });
  const update = (actors: readonly ActorRenderState[]) => {
    if (disposed) return;
    const legs: {
      kind: QueuedOrder["kind"];
      from: WorldPosition;
      to: WorldPosition;
    }[] = [];
    for (const actor of actors) {
      let from: Readonly<WorldPosition> =
        actor.movement?.target ??
        actor.attackMove?.target ??
        actor.combat?.attack?.lastKnown ??
        actor.worldPosition;
      for (const order of actor.orders ?? []) {
        const to = pointOf(order);
        if (!to) continue;
        legs.push({ kind: order.kind, from: { ...from }, to: { ...to } });
        from = to;
      }
    }
    // Moving attack targets redraw; otherwise the geometry is reused.
    const key = JSON.stringify(legs);
    if (key === drawn) return;
    drawn = key;
    mesh?.dispose();
    mesh = undefined;
    if (!legs.length) return;
    // Scan once per rebuild, after all pending terrain edits.
    const offset = aboveTerrainLayers(map, MARKER_OFFSET);
    const sample = (point: Readonly<WorldPosition>) =>
      groundPoint(map, point, offset);
    const lines: Vector3[][] = [];
    const colors: Color4[][] = [];
    const add = (line: Vector3[], color: Color4) => {
      lines.push(line);
      colors.push(line.map(() => color));
    };
    for (const { kind, from, to } of legs) {
      const color = ORDER_COLORS[kind];
      const length = distance(from, to);
      const along = (travelled: number) => {
        const t = length ? Math.min(travelled / length, 1) : 1;
        return sample({
          x: from.x + (to.x - from.x) * t,
          z: from.z + (to.z - from.z) * t,
        });
      };
      for (let start = 0; start < length; start += DASH_PERIOD)
        add([along(start), along(start + DASH_LENGTH)], color);
      if (kind === "attack")
        for (const line of groundCross(to, MARKER_RADIUS, sample))
          add(line, color);
      else
        add(
          groundRing(
            to,
            MARKER_RADIUS,
            // A four-sided ring reads as a diamond.
            kind === "gather" ? 4 : MARKER_SEGMENTS,
            sample,
          ),
          color,
        );
    }
    mesh = MeshBuilder.CreateLineSystem(
      "queued-orders",
      { lines, colors },
      scene,
    );
    mesh.isPickable = false;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    map.onChangedObservable.remove(terrainObserver);
    scene.onDisposeObservable.remove(sceneObserver);
    mesh?.dispose();
  };
  const sceneObserver = scene.onDisposeObservable.add(dispose);
  return {
    update,
    dispose,
  };
}
