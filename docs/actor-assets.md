# Actor assets

The Trooper and Scout load `public/assets/actors/arc-trooper.glb` and
`arc-scout.glb`. These are glTF 2.0 binary assets. Each GLB contains the mesh,
materials, skeleton, and named animation clips. `scripts/infantry-model.ts`
builds them; run `npm run assets:infantry` to rewrite both after changing it.
The unit tests fail while a committed GLB differs from what the script builds.

The GLB is the game asset. For hand-authored art, keep the editor's source file
such as a `.blend` alongside it and export a GLB for the game. A replacement
model must keep:

- A ground-level origin and forward direction along positive Z in the game.
- At least one skin with weighted mesh vertices.
- Idle and locomotion clips that key the same joints, so the runtime can blend
  between them. The locomotion clip covers one full gait cycle.
- Optionally, left and right turn clips. The runtime layers each one over the
  others as the difference from its first frame, so each starts at the neutral
  pose, ends at the full lean, and keys only the joints that lean.
- Clips that animate only nodes inside the model. Loading rejects a model that
  breaks this or lacks a named clip.

The runtime starts with stand-ins, then replaces them as their GLBs load. A
failed asset keeps its stand-in. Actor assets currently use core glTF 2.0
without extensions. Register a required extension centrally before adding an
asset that uses it; do not register unrelated model formats globally.

Each actor definition's `graphics` field supplies the GLB URL, clip names,
minimap color, pick and selection bounds, and ground distance covered by one
locomotion cycle. The runtime chooses clips and blends them from the rendered
pose. A replacement asset can use different joint names if its clips target the
new rig consistently.

Keep draw calls low: merge parts that share a material into one mesh. The
placeholder infantry use one vertex-colored body mesh and one emissive visor
mesh. Author PBR metallic-roughness materials with linear colors, since that is
what glTF stores and the game renders.
