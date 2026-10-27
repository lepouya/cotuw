# Actor assets

Run `npm run assets` to rebuild every bundled model and texture file. Generators
read code and seeded parameters, never an image, model, or editor source file.
`scripts/assets.ts` registers every generated file by family; add a new asset
there. Tests compare each committed file with fresh generation, check that pack
clips match their generators, and reject unregistered files in `public/assets`.

## Inventory

- `npm run assets:infantry`: `scripts/infantry-model.ts` exports Trooper,
  Scout, Sentinel, Wayfinder, and Cultivator meshes, materials, skeletons,
  idle, walk, turn, hit, and death clips. Troopers use aim and fire;
  Sentinels use aim and channeling clips. Circle personnel have slender
  proportions, pointed ears, exposed faces, circlets, tunics, and mantles,
  with blue owner markings.
  Sentinels wear layered leaf armor and channel violet focus artifacts;
  Wayfinders wear light hoods and carry wayfinding staves.
  Each asset ID has one recipe owning its scale, palette, geometry, gait, arm
  stance, and optional attack layer; only armed recipes export attack and aim
  clips. The shared exporter does not infer factions from role names. The
  unarmed ARC Scout omits rifle geometry. Cultivators carry a pod and a
  growth tool; their full-pose cultivation loop blends through the shared
  work-animation contract.
- `npm run assets:models`: `scripts/model-assets.ts` exports Command Center,
  Refinery, and Barracks meshes with idle machinery and activity clips; a
  skinned wolf with idle, walk, run, turn, bite, hit, and death; a rigid
  Harvester with idle, transit, deploy, harvest, stow, unload, hit, and death;
  crystal resource mounds; animated salvage; foundations; construction
  scaffolds; debris rubble; tracers; pulsing violet focus strands and sparks;
  bite marks; smoke puffs; flickering fire; wound drops; a pulsing regeneration
  halo; and a bird with a wing-beat clip. The alpha wolf scales the generated
  wolf asset.
- `scripts/circle-models.ts` supplies the Heartgrove's trunk and crown,
  Conservatory basin and canopy, vaulted Musterhall, and renewable bloom
  markers. Each ID has one recipe naming its size, frame, focus height, and
  basin. Owned buildings carry an owner marking; neutral sites do not. Named
  `growth-roots`, `growth-ribs`, and `growth-canopy` meshes
  define three construction layers without scaffolding. Active growth pulses;
  untended or capacity-blocked work holds still with a grey progress bar.
  Saved tick progress restores the layer. Static parts batch by layer and
  material, keeping the animated focus separate. Falling leaves show damage.
- Building and vehicle geometry builders in `src/render` supply the export
  script. A building's details declare `loopSeconds`, the period of their
  motion, which becomes the exported idle clip, and `activities`, whose
  one-shot motions become clips named for each activity. The base pack loads
  the resulting GLBs during gameplay.
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

## Production portraits

`src/ui/actor-portrait.ts` draws original SVG card illustrations. Content's
optional `portrait` binding selects one; otherwise the actor's gameplay role
chooses a generic icon. Circle portraits show exposed elven faces, pointed
ears, tunics, and role-specific gear: the Cultivator's pod and tending tool,
Sentinel leaf armor and focus, and Wayfinder hood and stave. Building portraits
match the Heartgrove crown, Conservatory basin, and vaulted Musterhall.

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
  pose, ends at the full lean, and keys only channels that idle also keys.
- Optionally, a `run` clip with the same pose channels and cycle distance as
  locomotion, selected during pursuit, and an additive `aim` clip whose final
  frame holds while the actor aims.
- Optionally, a looping `work` clip that replaces idle and locomotion while
  gathering and keys the same pose channels as idle. Optional `idle-signal`
  and `working-signal` meshes switch with this state and turn off on remains.
- Optional `deploy` and `stow` clips come as a pair with `work`, key the
  same pose channels as idle, and bridge idle to work and back. Their
  collector positions must match at complementary progress values so a
  reversed transition stays continuous. The first work state settles without
  replaying deployment; reduced motion settles all transitions.
- Optionally, a clip per trigger, such as `attack`, `hit`, or `unload`,
  layered the same way. It plays once each time the trigger fires, so it
  starts and ends at the neutral pose and keys only channels that idle also
  keys. Loading checks the matching endpoints and base channels for layers.
- Optionally, a death clip that plays once and holds at its last frame.
  It replaces the other clips, so it keys every pose channel idle keys and
  ends lying on the ground.
- Clips that animate only model nodes or attached morph targets and use one
  positive frame rate per clip, with ordered finite keys, values, and tangents.
  Each role names a distinct clip. Every role except idle needs more than one
  frame. Loading rejects a model that breaks this or lacks a named clip.

Generated clips sample the exact duration endpoint, including durations
between sample frames, so one-shots finish without a residual offset.

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

`building.glb` supplies a URL, an idle clip, and activity clips. The runtime
seats it above the terrain-conforming foundation and applies the building's
facing and tile size. Idle playback freezes during construction,
disconnection, and reduced motion. Activity clips start and end at rest and
key no channel that idle keys. Loading rejects overlapping idle channels,
duplicate channels, and activity endpoints that differ from the model's rest
pose. Instances own clips and node visibility. Materials are shared; offline
dimming and construction-stage clipping clone the materials they change.
Preview opacity stays on the meshes.

The pack's `props` names foundations, scaffolds, rubble, mounds, salvage,
tracers, bite marks, smoke, fire, wound drops, regeneration, and birds by URL,
with an optional idle clip. Salvage plays its exported hover and rotation
clip, fire its flicker, regeneration its pulse, and birds their wing beat. The
scaffold is a unit cube that construction stages scale around the footprint.
Mounds shrink in depletion stages without changing navigation.
