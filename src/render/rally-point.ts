import { groundPoint, groundRing } from "./ground-marker";
import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
import type { LinesMesh, Scene } from "@babylonjs/core";
import type { TerrainMap } from "../map";
import type { WorldPosition } from "../simulation/world";

export function createRallyPointView(scene: Scene, map: TerrainMap) {
  let marker: LinesMesh | undefined;
  let key = "";
  const observer = map.onChangedObservable.add(() => {
    key = "";
  });
  return {
    update: (point?: Readonly<WorldPosition>) => {
      const next = JSON.stringify(point);
      if (key === next) return;
      key = next;
      marker?.dispose();
      marker = undefined;
      if (!point) return;
      const ground = groundPoint(map, point, 0.15);
      const top = ground.add(new Vector3(0, 1.4, 0));
      marker = MeshBuilder.CreateLineSystem(
        "rally-point",
        {
          lines: [
            [
              ground,
              top,
              top.add(new Vector3(0.8, -0.2, 0)),
              top.add(new Vector3(0, -0.5, 0)),
            ],
            groundRing(point, 0.55, 32, (point) =>
              groundPoint(map, point, 0.15),
            ),
          ],
        },
        scene,
      );
      marker.color = new Color3(0.25, 0.95, 1);
      marker.isPickable = false;
    },
    dispose: () => {
      marker?.dispose();
      map.onChangedObservable.remove(observer);
    },
  };
}
