# Visual asset review

Review order follows when assets first appear in the introductions and
Normal skirmishes, how long they stay visible, and how often players use them
to make a decision. Review models with their materials, animations, and UI
portraits in the scene where they are used. [Actor assets](actor-assets.md)
and [audio assets](audio-assets.md) map the inventory to source generators.

## 1. Title and opening view

- Title screen, new mission and faction selection, loading state, application
  icon, and the in-game top bar, sidebar, and minimap frame. Review first
  impressions at launch and frequent use of the in-game interface.
- Grass, sparse grass, dirt, rock, water, clutter, and the grass sway sheet.
  Review terrain transitions, walls, crossings, map borders, scenic ground,
  ambient birds, lighting, shadows, and fog in both starts at gameplay zoom.
- ARC Command Center and Circle Heartgrove. Review their silhouettes, owner
  markings, entrances, materials, and idle motion. These are the first owned
  structures and anchor selection, construction, training, and recovery.
- Materials mounds, cultivation sites, salvage, and their map and world cues.
  Review neutral ownership, reserve and dormancy cues, and resource visibility
  against terrain and fog.
- Selection, placement, and support overlays, health and progress bars, repair
  and worker badges, rally points, queued orders, and movement markers.
  Include introductory guides and Goals, action and production cards, and
  portrait drawings as the actors they represent are reviewed.

## 2. First income and production

- ARC Refinery and Harvester, Circle Conservatory and Cultivator. Review
  door and delivery animation, cargo and work motion, tending, and whether
  the route from a resource site to its drop-off reads clearly.
- Foundations, scaffold, Circle growth stages, and construction previews.
  Check progress and paused work at normal camera distance.
- ARC Barracks and Circle Musterhall, then Trooper and Sentinel. Review
  entrances, production exits, default unit poses, and basic combat motion.
  Review Scout and Wayfinder alongside them for role recognition while moving.

## 3. First fight and expansion

- Wolf and alpha wolf, including gait, bite, hit, and death. Review den
  framing in both introductions.
- Rifle tracer and muzzle-flash sheet, Circle bolt, bite and wound effects,
  alongside impact feedback, damage smoke and fire, living leaks, leaves,
  fragments, and damage stages. Check direction, severity, and targets when
  several effects overlap.
- Relay Station, Sentry Turret, and Thornspire. Review support range cues,
  placement and facing, and which actor is firing in a base defense.
- ARC Medic, Mechanic, and Demolition Trooper, Circle Healer, Artificer,
  Construct Nursery, and Briar Ram. Review role and owner recognition in a
  mixed army, support gestures and symbols, regeneration effects, rocket and
  rocket impact, launch-flash sheet, and the Ram's strike and splinter burst.

## 4. Loss, recovery, and results

- Unit remains and wrecks, ARC debris rubble, Circle living rubble, and
  salvage in a damaged base. Review what survives an attack and whether the
  player can read the surviving actors and routes while rebuilding.
- Victory and defeat presentation, match summary, pause and save panels, and
  return to title. Review the result and the next available action.

Review the soundtrack, command and alert cues, work and production sounds,
combat, support, and result cues with the corresponding scenes. Keep the
audio review tied to the scene's timing and readability.

## Reviewing a changed asset

Judge each ARC asset against the Command Center and each Circle asset against
the Heartgrove, so the factions keep a consistent silhouette and material
contrast against grass, dirt, and rock. Review changed assets at the starting
camera and after rotating or zooming. Check motion, team colors, construction
and damage states where applicable, and the visual load in a fight. Follow the
[asset and browser checks](verification.md#automated-checks) and the gate in
[TODO.md](../TODO.md#g-external-feedback-and-milestone-acceptance).
