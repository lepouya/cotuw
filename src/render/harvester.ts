import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
} from "@babylonjs/core";
import { createMeshAppearance } from "./actor";
import type { Scene } from "@babylonjs/core";
import type { ActorAppearance } from "./actor";

export function createHarvesterAppearance(
  scene: Scene,
  reducedMotion: () => boolean = () => false,
): ActorAppearance {
  const root = new TransformNode("harvester-template", scene);
  const steel = new StandardMaterial("harvester-steel", scene);
  steel.diffuseColor = new Color3(0.78, 0.58, 0.2);
  const rubber = new StandardMaterial("harvester-tracks", scene);
  rubber.diffuseColor = new Color3(0.12, 0.16, 0.17);
  const box = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: StandardMaterial,
  ) => {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.parent = root;
    mesh.position.set(x, y, z);
    mesh.material = material;
  };
  box("harvester-chassis", 0.7, 0.35, 1.1, 0, 0.45, 0, steel);
  box("harvester-cab", 0.55, 0.4, 0.45, 0, 0.82, 0.25, steel);
  box("harvester-left-track", 0.2, 0.28, 1.25, -0.43, 0.25, 0, rubber);
  box("harvester-right-track", 0.2, 0.28, 1.25, 0.43, 0.25, 0, rubber);
  const body = createMeshAppearance(
    root,
    { radius: 0.72, height: 1.2 },
    [0.94, 0.7, 0.22],
  );
  return {
    ...body,
    instantiate: (name, seed) => {
      const instance = body.instantiate(name, seed);
      const drill = new TransformNode(`${name}-drill`, scene);
      drill.parent = instance.root;
      drill.position.set(0, 0.65, 0.8);
      const head = MeshBuilder.CreateCylinder(
        `${name}-drill-head`,
        {
          height: 0.35,
          diameterTop: 0.06,
          diameterBottom: 0.5,
          tessellation: 6,
        },
        scene,
      );
      head.parent = drill;
      head.rotation.x = Math.PI / 2;
      head.material = rubber;
      for (let i = 0; i < 4; i++) {
        const tooth = MeshBuilder.CreateBox(
          `${name}-drill-tooth-${i}`,
          { width: 0.13, height: 0.17, depth: 0.12 },
          scene,
        );
        tooth.parent = drill;
        tooth.position.set(
          Math.cos((i * Math.PI) / 2) * 0.23,
          Math.sin((i * Math.PI) / 2) * 0.23,
          0,
        );
        tooth.rotation.z = (i * Math.PI) / 2;
        tooth.material = steel;
      }
      const signal = new StandardMaterial(`${name}-work-signal`, scene);
      const beacon = MeshBuilder.CreateCylinder(
        `${name}-work-beacon`,
        { height: 0.12, diameter: 0.23, tessellation: 8 },
        scene,
      );
      beacon.parent = instance.root;
      beacon.position.set(0, 1.1, 0.25);
      beacon.material = signal;
      let working = false;
      let elapsed = seed * Math.PI * 2;
      return {
        root: instance.root,
        setWorking: (next) => {
          working = next;
          signal.diffuseColor.set(
            working ? 0.2 : 1,
            working ? 1 : 0.6,
            working ? 0.65 : 0.15,
          );
          signal.emissiveColor = signal.diffuseColor.scale(
            working ? 0.8 : 0.25,
          );
          drill.position.y = working ? 0.3 : 0.65;
        },
        animate: ({ seconds }) => {
          if (reducedMotion()) return;
          elapsed += seconds;
          if (working) {
            drill.rotation.z += seconds * 9;
            drill.position.y = 0.3 + Math.sin(elapsed * 12) * 0.035;
            beacon.scaling.y = 1 + Math.sin(elapsed * 5) * 0.2;
          } else {
            beacon.scaling.y = 1;
          }
        },
        dispose: () => {
          instance.dispose();
          signal.dispose();
        },
      };
    },
  };
}
