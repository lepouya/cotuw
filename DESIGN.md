# Design

This is the living design source of truth. Keep entries concise; add detail only
when it informs a prototype, implementation, or content decision.

## Vision

_Citadels of the Unquiet World_ is an approachable science-fantasy real-time
strategy game. Players build bases, control territory, assemble combined-arms
forces, and fight across a living world that becomes progressively more hostile.

## Setting and story

Two rival coalitions fight over a damaged frontier world governed by remnants of
ancient glyph engines: systems that respond to symbols, ritual, and will.

- The technology-and-weapons coalition seeks to stabilize the world through
  industry and controlled use of the old systems.
- The magic-and-nature coalition seeks to preserve the world's old balances and
  resist industrial extraction.
- Their war destabilizes the world's seals and awakens the force that ruined it
  before.

The single-player campaign lets the player choose either coalition. Both
narratives escalate from faction conflict to an uneasy alliance against the
awakened world threat. Neither steel nor magic can save the world alone.

## Gameplay pillars

1. **Readable combined-arms warfare** — classic base building, production,
   scouting, counters, and positional tactics.
2. **Meaningfully asymmetric factions** — factions differ in economy,
   infrastructure, mobility, defense, and battlefield tools.
3. **A living hostile world** — ancient sites, unstable wards, corruption, and
   world events create strategic decisions beyond attacking the opponent.
4. **Approachable strategic depth** — scouting, planning, and map control matter
   more than extreme actions-per-minute.
5. **Small playable core first** — expand only after the basic RTS loop is fun.

## Requirements and scope

- 3D world with an isometric/top-down strategy camera.
- Visual readability over photorealism.
- Desktop first: Windows and macOS.
- Linux/SteamOS, browser, Android, and iOS are future targets.
- Eventual small-session multiplayer, roughly four players; no massively
  multiplayer features.
- Data-driven game content to support balancing, campaigns, and eventual mods.
- Original setting, names, art, and lore.

## Technical direction

- Native packaging: Tauri 2
- Web build: Vite
- Package manager: npm
- Language: TypeScript
- 3D rendering: Babylon.js

The core game remains browser-runnable. Tauri-specific functionality must stay
behind platform-service boundaries so simulation, rendering, and UI remain
portable.

## Core match

### Initial target

- Traditional RTS loop: establish a base, gather resources, build production,
  scout, expand, and defeat the opponent.
- One small map, one resource system, one enemy AI, and a clear win/lose
  condition.
- The world threat begins as map pressure, not a conventional third
  base-building opponent.

## Factions

### Technology and weapons coalition

**Narrative:** A human-led, multi-peoples coalition that favors industry,
disciplined organization, and controlled use of ancient systems.

**Identity:** Factories, power networks, armored units, artillery, repairs,
modular structures, and strong defensive positions.

**Strengths:** Reliable production, durable combined arms, static defense,
long-range firepower, repair, and logistical scaling.

**Weaknesses:** Slower relocation; reliance on infrastructure; vulnerable to
power disruption and flanking.

### Magic and nature coalition

**Narrative:** A coalition of peoples bound to the living world that resists
extraction and seeks control of the old powers on its own terms.

**Identity:** Living structures, ley-line influence, bonded creatures, healing,
concealment, mobility, and terrain manipulation.

**Strengths:** Flexible expansion, mobility, localized regeneration, ambushes,
adaptive defenses, and control of terrain or world sites.

**Weaknesses:** Less direct siege power; dependence on favorable terrain and
connected magical infrastructure.

### Awakened world threat

**Narrative:** The restrained force beneath or beyond the world that previously
ruined it.

**Identity:** Rifts, corruption, hostile guardians, escalating events, contested
ancient sites, and later large-scale assaults.

**Rule:** It is initially non-playable and environmental. It becomes
increasingly organized through the campaign.

## Units and structures

### Unit role vocabulary

- Vanguard: armored frontline.
- Skirmisher: scout, raider, or ambusher.
- Artificer: builder, repairer, or siege engineer.
- Channeler: support, shields, buffs, or battlefield magic.
- Warden: control, summons, or terrain manipulation.

## Maps and world systems

### Map elements

- Expansion locations and resource sites.
- Ancient sites with risks and rewards.
- Wards, rifts, or corrupted regions that create pressure.
- Terrain that supports flanking, defense, ambushes, and strategic movement.

## Campaign

1. **Claim:** Establish the chosen faction's goals and teach the core RTS loop.
2. **Escalation:** Intensify the war with the opposing faction.
3. **Unease:** Reveal instability around ancient sites and the world threat.
4. **Revelation:** Show that neither faction understands the crisis completely.
5. **Alliance:** Create an uneasy coalition with the former enemy.
6. **Reckoning:** Use both approaches to confront the awakened threat.

Alliance missions should work with an AI ally first and leave room for future
co-op, with each player controlling a different faction.

## Decision record

### Locked — 2026-09-15

- **Working title:** _Citadels of the Unquiet World_. It remains tentative until
  a formal trademark review is warranted.
- **Theme:** science-fantasy RTS: an industrial coalition and a magic-and-nature
  coalition awaken a world-threatening force, then must cooperate to stop it.
- **Campaign premise:** the player chooses either coalition; both campaigns
  progress from faction war to the shared threat.
- **Technical direction:** Tauri 2, Vite, npm, TypeScript, and Babylon.js.
- **Initial delivery focus:** Windows and macOS; browser compatibility remains a
  core constraint.

### Prototype — 2026-09-16

- **Terrain proof of concept:** a 100 by 100 tile heightfield uses a shared grid
  of corner heights. Babylon.js renders it through an orthographic, isometric
  strategy camera with orbit, pan, and zoom controls. The map keeps its
  canonical shared corner-height grid separate from its per-tile visual layers.
  Each tile has an ordered stack of colored or string-addressed texture layers,
  each with an RGBA color. The prototype enables optional tile and map-boundary
  lines for debugging.

### Prototype — 2026-09-19

- **Dynamic terrain editing:** Terrain state is mutable and intentionally open
  to trusted game code. Simulation code mutates it directly and reports the
  affected tile bounds through the map's observable. Rendering systems own
  their subscriptions, batch reports by frame, rebuild only affected terrain
  chunks, and unsubscribe when disposed. Shared materials and textures persist
  across chunk rebuilds so visual animation state is independent of terrain
  mutation.
- **Game view setup:** Creating a game view installs the standard strategy
  camera, fits it to the map footprint at the level's ground height of zero, and
  creates lighting from the level's view configuration. Terraforming does not
  alter camera framing. The view exposes tile focusing and its lights for
  scripted changes. Callers add only the world-specific renderers and overlays
  they need.

### To decide

- **Core match**
  - Minimum playable RTS loop and first vertical-slice scope.
  - Match duration and intended army size.
  - Resource, construction, production, and victory systems.
  - Exact win condition or conditions.
  - Economy: harvesting, control points, salvage, ley wells, or a combination.
  - Desired level of unit micro and automation.
  - How active the world threat is in skirmish play.
- **Factions and units**
  - Faction economies, unit rosters, technologies, and signatures.
  - Starting units and structures for each faction.
  - Unit roster and counter relationships.
  - Construction and production rules.
  - Tech tiers and faction-specific upgrades.
  - Alliance-only units or abilities for late campaign missions.
- **Maps and world systems**
  - Map structure, world events, neutral threats, and environmental systems.
  - Initial map size and terrain palette.
  - Resource placement rules.
  - World-event cadence and escalation.
  - Whether corruption spreads, and how players counter or exploit it.
- **Campaign and skirmish**
  - Campaign structure and initial skirmish map set.
- **Interface and presentation**
  - Camera, controls, UI, and accessibility requirements.
  - Art direction, audio direction, and asset-production approach.
- **Future systems**
  - Multiplayer model, lobby flow, networking, and save/replay requirements.
  - Modding scope and content-data format.
