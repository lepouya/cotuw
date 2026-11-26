// Shared steps for building generated models in a scene.
import {
  Animation,
  AnimationGroup,
  Bone,
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Skeleton,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";

import { FRAMES_PER_SECOND, rigidSkin } from "./glb-export.ts";

import type { Material, Scene } from "@babylonjs/core";

export type Vec3 = readonly [number, number, number];

/** Where a part sits; omitted fields keep the mesh's defaults. */
export type Placement = {
  parent?: TransformNode;
  material?: Material;
  position?: Vec3;
  rotation?: Vec3;
  scaling?: Vec3;
};

export function place<T extends Mesh>(
  mesh: T,
  { parent, material, position, rotation, scaling }: Placement,
): T {
  if (parent) mesh.parent = parent;
  if (material) mesh.material = material;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scaling) mesh.scaling.set(...scaling);
  return mesh;
}

/** A capped tube through `points`, tapered when `radius` lists one per point. */
export function tube(
  scene: Scene,
  name: string,
  points: readonly Vec3[],
  radius: number | readonly number[],
  tessellation = 6,
) {
  return MeshBuilder.CreateTube(
    name,
    {
      path: points.map((point) => new Vector3(...point)),
      ...(typeof radius === "number"
        ? { radius }
        : { radiusFunction: (index: number) => radius[index]! }),
      tessellation,
      cap: Mesh.CAP_ALL,
    },
    scene,
  );
}

/** Joins equally sized rings in boundary order, optionally to an apex. */
export function loft(rings: readonly (readonly Vec3[])[], apex?: Vec3) {
  const count = rings[0]!.length;
  const bands = rings.length - 1;
  const last = bands * count;
  const vertex = [...rings.flat(), ...(apex ? [apex] : [])].map((point) => [
    ...point,
  ]);
  const ring = Array.from({ length: count }, (_, i) => i);
  // Fan both caps from the same corner. The outline must suit that fan.
  const face = [ring];
  if (!apex)
    face.push([
      last,
      ...ring
        .slice(1)
        .reverse()
        .map((i) => last + i),
    ]);
  const passes = Math.max(1, bands);
  for (let band = 0; band < passes; band++)
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const a = band * count + i;
      const b = band * count + next;
      if (band < bands) face.push([b, a, a + count, b + count]);
      if (apex && band === passes - 1)
        face.push([last + next, last + i, last + count]);
    }
  return { vertex, face };
}

/** Folded eight-point outline closed by a raised ridge and a lower keel. */
export function foldedBlade(vertex: number[][]) {
  return {
    vertex,
    face: Array.from({ length: 8 }, (_, edge) => {
      const next = (edge + 1) % 8;
      return [
        [edge, next, 8],
        [next, edge, 9],
      ];
    }).flat(),
  };
}

/** Colors each vertex from its rest position. */
export function paint(
  mesh: Mesh,
  color: (x: number, y: number, z: number) => Color3,
) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const { r, g, b } = color(
      positions[i]!,
      positions[i + 1]!,
      positions[i + 2]!,
    );
    colors.push(r, g, b, 1);
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/** Groups meshes by material, in first-seen order. */
export function byMaterial(meshes: Iterable<Mesh>) {
  const groups = new Map<StandardMaterial, Mesh[]>();
  for (const mesh of meshes) {
    if (!(mesh.material instanceof StandardMaterial)) continue;
    const group = groups.get(mesh.material) ?? [];
    group.push(mesh);
    groups.set(mesh.material, group);
  }
  return groups;
}

/** Collects parts per finish, then bakes each finish into one named mesh. */
export function batches<K extends string>(
  root: TransformNode,
  finishes: Record<K, StandardMaterial>,
) {
  const names = Object.keys(finishes) as K[];
  const parts = Object.fromEntries(names.map((key) => [key, [] as Mesh[]]));
  return {
    add: <T extends Mesh>(finish: K, mesh: T) => {
      parts[finish]!.push(mesh);
      return mesh;
    },
    count: (finish: K) => parts[finish]!.length,
    merge: () => {
      for (const key of names) merge(root, key, parts[key]!, finishes[key]);
    },
  };
}

/** A matte generated-model material; `glow` scales its self-illumination. */
export function surface(
  scene: Scene,
  name: string,
  color: Color3 | readonly [number, number, number],
  glow = 0,
) {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor =
    color instanceof Color3 ? color.clone() : new Color3(...color);
  material.specularColor = Color3.Black();
  if (glow) material.emissiveColor = material.diffuseColor.scale(glow);
  return material;
}

export function unlit(scene: Scene, name: string, color: Color3) {
  const material = surface(scene, name, color);
  material.disableLighting = true;
  material.emissiveColor = material.diffuseColor;
  return material;
}

/** Bakes parts that share a material into one mesh, keeping draw calls low. */
export function merge(
  root: TransformNode,
  name: string,
  parts: Mesh[],
  material: StandardMaterial,
) {
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.convertToFlatShadedMesh();
  mesh.name = name;
  mesh.material = material;
  mesh.parent = root;
  // Babylon merges world-space vertices. Seat them in the parent's space.
  const toLocal = root.computeWorldMatrix(true).clone().invert();
  if (!toLocal.isIdentity()) mesh.bakeTransformIntoVertices(toLocal);
  return mesh;
}

/**
 * Samples authored poses into glTF node channels; playback needs no builder.
 * Without `completePose`, channels that never move are left out.
 */
export function clip(
  root: TransformNode,
  name: string,
  seconds: number,
  pose: (seconds: number) => void,
  completePose = true,
): void {
  const nodes = [
    root,
    ...root
      .getDescendants(false)
      .filter((node): node is TransformNode => node instanceof TransformNode),
  ];
  // An earlier clip stores rest rotations as quaternions, zeroing Euler ones.
  const rest = nodes.map((node) => ({
    position: node.position.clone(),
    rotation: node.rotationQuaternion?.toEulerAngles() ?? node.rotation.clone(),
    scaling: node.scaling.clone(),
  }));
  for (const node of nodes) node.rotationQuaternion = null;
  const restore = () =>
    nodes.forEach((node, index) => {
      node.position.copyFrom(rest[index]!.position);
      node.rotation.copyFrom(rest[index]!.rotation);
      node.scaling.copyFrom(rest[index]!.scaling);
    });
  const endFrame = seconds * FRAMES_PER_SECOND;
  const frames = Math.ceil(endFrame);
  const keys = nodes.map(() => ({
    position: [] as { frame: number; value: Vector3 }[],
    rotationQuaternion: [] as { frame: number; value: Quaternion }[],
    scaling: [] as { frame: number; value: Vector3 }[],
  }));
  for (let frame = 0; frame <= frames; frame++) {
    restore();
    // Include the exact endpoint between sample frames.
    const keyFrame = Math.min(frame, endFrame);
    pose(keyFrame / FRAMES_PER_SECOND);
    nodes.forEach((node, index) => {
      keys[index]!.position.push({
        frame: keyFrame,
        value: node.position.clone(),
      });
      keys[index]!.rotationQuaternion.push({
        frame: keyFrame,
        value: Quaternion.FromEulerVector(node.rotation),
      });
      keys[index]!.scaling.push({
        frame: keyFrame,
        value: node.scaling.clone(),
      });
    });
  }
  const group = new AnimationGroup(name, root.getScene());
  restore();
  nodes.forEach((node, index) => {
    node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    for (const property of [
      "position",
      "rotationQuaternion",
      "scaling",
    ] as const) {
      const values = keys[index]![property];
      const first = values[0]!.value.asArray();
      if (
        !completePose &&
        values.every(({ value }) =>
          value
            .asArray()
            .every((component, channel) => component === first[channel]),
        )
      )
        continue;
      const animation = new Animation(
        `${name}-${node.name}-${property}`,
        property,
        FRAMES_PER_SECOND,
        property === "rotationQuaternion"
          ? Animation.ANIMATIONTYPE_QUATERNION
          : Animation.ANIMATIONTYPE_VECTOR3,
      );
      animation.setKeys(values);
      group.addTargetedAnimation(animation, node);
    }
  });
}

/**
 * Rigid weights preserve the part hierarchy while exporting a real skin.
 * Static pieces share the body bone and moving pieces bind to their pivots.
 * Each material becomes one skinned mesh.
 */
export function skin(root: TransformNode) {
  const scene = root.getScene();
  const parts = root
    .getChildMeshes()
    .filter(
      (mesh): mesh is Mesh =>
        mesh instanceof Mesh && mesh.getTotalVertices() > 0,
    );
  const vertices = parts.map((part) => {
    const data = VertexData.ExtractFromMesh(part);
    data.transform(part.computeWorldMatrix(true));
    return data;
  });
  const body = new TransformNode(`${root.name}-body-joint`, scene);
  body.parent = root;
  const joints = parts.map((part) =>
    part.parent === root ? body : (part.parent as TransformNode),
  );
  const skeleton = new Skeleton(`${root.name}-rig`, `${root.name}-rig`, scene);
  const bones = new Map<TransformNode, Bone>();
  const add = (node: TransformNode): Bone | null => {
    if (node === root) return null;
    if (bones.has(node)) return bones.get(node)!;
    const parent =
      node.parent instanceof TransformNode ? add(node.parent) : null;
    const matrix = Matrix.Compose(
      node.scaling,
      Quaternion.FromEulerVector(node.rotation),
      node.position,
    );
    const bone = new Bone(node.name, skeleton, parent, matrix);
    bone.linkTransformNode(node);
    bones.set(node, bone);
    return bone;
  };
  for (const joint of joints) add(joint);
  const pieces = parts.map((part, index) => ({
    material: part.material!,
    vertices: vertices[index]!,
    bone: skeleton.bones.indexOf(bones.get(joints[index]!)!),
  }));
  for (const material of new Set(pieces.map((piece) => piece.material)))
    rigidSkin(
      `${root.name}-${material.name}-skin`,
      pieces.filter((piece) => piece.material === material),
      skeleton,
      material,
      root,
    );
  for (const part of parts) part.dispose(false, false);
}
