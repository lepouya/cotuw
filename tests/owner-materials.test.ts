import {
  Color3,
  MeshBuilder,
  NullEngine,
  PBRMaterial,
  Scene,
  StandardMaterial,
} from "@babylonjs/core";
import { expect, test } from "vitest";

import { createOwnerMaterials } from "../src/render/owner-materials";

test("owner materials share one recolored copy per source and owner", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const owner = new PBRMaterial("arc-trooper-owner", scene);
  const body = new StandardMaterial("armor", scene);
  const mesh = (material: StandardMaterial | PBRMaterial) => {
    const result = MeshBuilder.CreateBox("part", {}, scene);
    result.material = material;
    return result;
  };
  const [first, second, third, armor] = [owner, owner, owner, body].map(mesh);
  const materials = createOwnerMaterials(
    new Map([
      ["west", [0.2, 0.45, 1]],
      ["east", [0.92, 0.18, 0.15]],
    ]),
  );

  materials.apply([first!, second!, armor!], "west");
  const firstCopy = first!.material;
  materials.apply([first!, second!], "west");
  expect(first!.material).toBe(firstCopy);
  materials.apply([third!], "east");
  materials.apply([first!], "wildlife");

  expect(first!.material).toBe(second!.material);
  expect(first!.material).not.toBe(owner);
  expect(third!.material).not.toBe(first!.material);
  expect(armor!.material).toBe(body);
  expect((first!.material as PBRMaterial).albedoColor).toEqual(
    new Color3(0.2, 0.45, 1).toLinearSpace(),
  );

  const copies = [first!.material, third!.material];
  materials.dispose();
  for (const copy of copies) expect(scene.materials).not.toContain(copy);
  expect(scene.materials).toContain(owner);
  scene.dispose();
  engine.dispose();
});
