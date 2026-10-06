# Actor assets

Run `npm run assets` to rebuild every bundled model and texture file. Generators
read code and seeded parameters, never an image, model, or editor source file.
`scripts/assets.ts` registers every generated file by family; add a new asset
there. Tests compare each committed file with fresh generation, check that pack
clips match their generators, and reject unregistered files in `public/assets`.

## Inventory

- `npm run assets:infantry`: `scripts/infantry-model.ts` exports Trooper and
  Scout meshes, materials, skeletons, idle, walk, turn, and death clips. The
  Trooper uses the fire clip for combat.
- `npm run assets:models`: `scripts/model-assets.ts` exports Command Center,
  Refinery, and Barracks meshes and idle machinery clips; a skinned wolf with
  idle, walk, bite, and death; a rigid Harvester with idle, transit, harvest,
  and death; crystal resource mounds; animated salvage; foundations; debris
  rubble; tracers; and bite marks. The alpha wolf scales the generated wolf
  asset.
- Building and vehicle geometry builders in `src/render` supply the export
  script. A building's details declare `loopSeconds`, the period of their
  motion, which becomes the exported idle clip. The base pack loads the
  resulting GLBs during gameplay.
- Models use generated materials and vertex colors. They require no separate
  painted texture files.
- `npm run assets:terrain`: `scripts/terrain-textures.ts` generates seamless
  dirt, water, clutter, and rock PNGs from periodic gradient and cellular
  noise. Dirt spans eight tiles per repeat with warped soil, damp patches, and
  pebbles. Water uses broad crests across four tiles per repeat; motion comes
  from scrolling two layers. Clutter scatters lit, irregular stones in
  clusters. Rock covers hillsides and cliffs with cracked, faceted plates
  across four tiles per repeat. Hill shapes come from the mission heightfield.
- `npm run assets:grass`: `scripts/grass-sheet.ts` generates dense and sparse
  grass sprite sheets with looping sway.
- `npm run assets:effects`: `scripts/muzzle-flash-sheet.ts` generates the
  Trooper's muzzle-flash sprite sheet.

Each command prints its textures' minimap colors and its clip definitions;
update matching content-pack graphics when changing the art.
Generated terrain edges match by construction and need no reconciliation pass.
Foundations and rubble are unit-cube models scaled to their placement.
Ground markers, bars, fog, and other interface overlays are runtime geometry.

## Mobile model contract

A generated model must keep:

- A ground-level origin and forward direction along positive Z in the game.
- At least one skin with weighted mesh vertices, or `rig: "rigid"` for
  articulated machinery.
- Idle and locomotion clips that key the same joints, so the runtime can blend
  between them. Each keys the same node properties; the locomotion clip covers
  one full gait cycle.
- Optionally, left and right turn clips. The runtime layers each one over the
  others as the difference from its first frame, so each starts at the neutral
  pose, ends at the full lean, and keys only the joints that lean.
- Optionally, a looping `work` clip that replaces idle and locomotion while
  gathering and keys the same pose channels as idle. Optional `idle-signal`
  and `working-signal` meshes switch with this state and turn off on remains.
- Optionally, a clip per trigger, such as `attack`, layered the same way. It
  plays once each time the trigger fires, so it starts and ends at the
  neutral pose and keys only the joints that move.
- Optionally, a death clip that remains play once and hold at its last frame.
  It replaces the other clips, so it keys every pose channel idle keys and
  ends lying on the ground.
- Clips that animate only model nodes or attached morph targets and use one
  positive frame rate per clip, with ordered finite keys, values, and tangents.
  Each role names a distinct clip. Locomotion, turn, trigger, work, and death
  clips need more than one frame. Loading rejects a model that breaks this or
  lacks a named clip.

The runtime starts with stand-ins, then replaces them as their GLBs load. A
failed asset keeps its stand-in. Remains refresh when a model loads. Sessions
expose `disposeAsync()` so pending loads finish before releasing the engine.
Generated assets use glTF 2.0 and `KHR_materials_unlit` for eyes and weapon
effects.
Register any additional extension centrally before exporting an asset that
uses it.

Each actor's `model.glb` presentation supplies the GLB URL, clip names,
minimap color, pick and selection bounds, and ground distance covered by one
locomotion cycle. Optional `scale` scales the mesh; bounds and cycle distance
use final world units. The runtime chooses clips from the rendered
pose, triggers, and remains, as [DESIGN.md](../DESIGN.md#actor-animation)
describes. A replacement asset can use different joint names if its clips
target the new rig consistently.

Keep draw calls low: merge parts that share a material into one mesh. The
placeholder infantry use one vertex-colored body mesh and one emissive visor
mesh. Author PBR metallic-roughness materials with linear colors, since that is
what glTF stores and the game renders.

## Buildings and props

`building.glb` supplies a URL and idle clip. The runtime seats it above the
terrain-conforming foundation and applies the building's facing and tile size.
Idle playback freezes during construction, disconnection, and reduced motion.
Instances own clips and node visibility. Materials are shared; offline dimming
clones the materials it changes. Preview opacity stays on the meshes.

The pack's `props` names foundations, rubble, mounds, salvage, tracers, and bite
marks by URL, with an optional idle clip. Salvage plays its exported hover and
rotation clip. Mounds shrink in depletion stages without changing navigation.
