// Shared steps for generated GLB models.
import { Mesh, NullEngine, Scene, VertexBuffer } from "@babylonjs/core";
import { GLTF2Export } from "@babylonjs/serializers/glTF/index.js";

import type {
  Material,
  Skeleton,
  TransformNode,
  VertexData,
} from "@babylonjs/core";

export const FRAMES_PER_SECOND = 30;

/** Builds a model into an empty scene and exports it as GLB bytes. */
export async function exportGlb(
  name: string,
  build: (scene: Scene) => void,
): Promise<Uint8Array> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    build(scene);
    const data = await GLTF2Export.GLBAsync(scene, name);
    const blob = data.files[`${name}.glb`];
    if (!(blob instanceof Blob))
      throw new Error(`Exporter did not produce ${name}.glb`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

/**
 * Merges parts into one skinned mesh, each part weighted fully to one bone,
 * so a single draw call keeps the part hierarchy.
 */
export function rigidSkin(
  name: string,
  parts: readonly { vertices: VertexData; bone: number }[],
  skeleton: Skeleton,
  material: Material,
  parent: TransformNode,
): Mesh {
  if (
    parts.length === 0 ||
    parts.some(
      ({ bone }) =>
        !Number.isInteger(bone) ||
        bone < 0 ||
        bone >= skeleton.bones.length ||
        bone > 65535,
    )
  )
    throw new RangeError(
      "A rigid skin needs parts with valid glTF joint indices",
    );
  const scene = parent.getScene();
  const counts = parts.map(({ vertices }) => vertices.positions!.length / 3);
  const [merged, ...rest] = parts.map(({ vertices }) => vertices);
  merged!.merge(rest, true);
  const mesh = new Mesh(name, scene);
  merged!.applyToMesh(mesh);
  // Integer joint indices, as glTF stores them; floats would export padded.
  const JointArray = skeleton.bones.length > 256 ? Uint16Array : Uint8Array;
  const joints = new JointArray(mesh.getTotalVertices() * 4);
  const weights = new Float32Array(joints.length);
  let vertex = 0;
  parts.forEach(({ bone }, index) => {
    for (const end = vertex + counts[index]!; vertex < end; vertex++) {
      joints[vertex * 4] = bone;
      weights[vertex * 4] = 1;
    }
  });
  mesh.setVerticesBuffer(
    new VertexBuffer(
      scene.getEngine(),
      joints,
      VertexBuffer.MatricesIndicesKind,
      { size: 4 },
    ),
  );
  mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights);
  mesh.skeleton = skeleton;
  mesh.material = material;
  mesh.parent = parent;
  return mesh;
}
