import {
  FreeCamera,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { expect, test } from "vitest";
import type { Mesh } from "@babylonjs/core";

import { testScene } from "./helpers/scene";
import { createScreenBar } from "../src/render/screen-bar";

test.each([new Vector3(10, 20, -20), new Vector3(-20, 15, 10)])(
  "keeps construction bar geometry local and layered with camera %s",
  (position) => {
    const scene = testScene();
    const camera = new FreeCamera("camera", position, scene);
    camera.setTarget(Vector3.Zero());
    const frame = new StandardMaterial("frame", scene);
    const bar = createScreenBar(scene, "construction", { width: 2, frame });
    const [border, fill] = bar.root.getChildMeshes() as [Mesh, Mesh];
    const positions = border.getVerticesData(VertexBuffer.PositionKind)!;
    expect(
      Math.min(...positions.filter((_, index) => index % 3 === 0)),
    ).toBeCloseTo(-1.03);
    expect(
      Math.max(...positions.filter((_, index) => index % 3 === 0)),
    ).toBeCloseTo(1.03);
    expect(
      Math.max(...positions.filter((_, index) => index % 3 === 1)),
    ).toBeCloseTo(0.09);
    expect(
      Math.max(
        ...positions.filter((_, index) => index % 3 === 2).map(Math.abs),
      ),
    ).toBeCloseTo(0);
    bar.setFill(0.5, frame);
    expect(fill.scaling.x).toBe(0.5);
    expect(fill.position.x).toBe(-0.5);
    expect(scene.meshes).toHaveLength(2);
    const draws: string[] = [];
    for (const mesh of [border, fill]) {
      mesh.visibility = 0.5;
      mesh.onBeforeRenderObservable.add(() => draws.push(mesh.name));
    }
    scene.render();
    expect(draws).toEqual(["construction-frame", "construction-fill"]);
    bar.root.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toContain(frame);
  },
);
