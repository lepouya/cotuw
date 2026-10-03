# Design Questionnaire

This is the retained questionnaire and decision journal for the game's design.
It supports Roadmap tasks 0.1-0.3 while also recording game-wide decisions
uncovered while defining the first playable slice. It preserves the discussion,
alternatives, rejected options, and deferred questions that explain how the
design developed.

`DESIGN.md` remains the source of truth for locked game specifications. Record
decision dates here and summarize current requirements there without dated
decision entries. Keep this document as supporting rationale and reference.

## Table of contents

This index tracks the state of each main or named subquestion. Follow-ups remain
within their parent question.

- **Resolved:** [Q1 — Player role](#q1-who-is-the-player-in-this-slice)
  - **Resolved:** [Q1a — Faction identities](
    #q1a-what-are-the-factions-called-and-what-are-they)
  - **Resolved:** [Q1b — Player titles](
    #q1b-what-does-each-faction-call-the-player)
- **Resolved:** [Q2 — Player fantasy](
  #q2-what-should-the-player-feel-they-are-doing)
- **Resolved:** [Q3 — Slice scenario](#q3-what-is-happening-in-the-slice)
  - **Resolved:** [Q3a — Citadel scope](
    #q3a-does-milestone-0-contain-a-citadel)
  - **Resolved:** [Q3b — First hostile contact](
    #q3b-what-is-arcs-first-hostile-contact)
- **Resolved:** [Q4 — Immediate objective](
  #q4-what-is-the-players-immediate-objective)
- **Resolved:** [Q5 — Failure and recovery](
  #q5-what-can-impede-the-player-or-cause-failure)
- **Resolved:** [Q6 — Interaction loop](
  #q6-what-is-the-smallest-repeatable-interaction-loop)
- **Resolved:** [Q7 — Command Center establishment](
  #q7-how-is-the-command-center-established)
- **Resolved:** [Q8 — Economy, construction, and production](
  #q8-how-do-resources-construction-and-production-work)
- **Resolved:** [Q9 — M0 roster and structures](
  #q9-which-units-and-buildings-does-the-slice-need)
- **Resolved:** [Q10 — Controls and camera](
  #q10-how-should-selecting-commanding-and-moving-the-camera-work)
- **Resolved:** [Q11 — Actor movement](#q11-how-should-actors-move)
- **Resolved:** [Q12 — Terrain traversal](
  #q12-what-terrain-and-objects-are-traversable)
- **Resolved:** [Q13 — Test-map situations](
  #q13-what-situations-must-the-test-map-contain)
- **Resolved:** [Q14 — Exploration and fog of war](
  #q14-how-do-exploration-and-fog-of-war-work)
- **Resolved:** [Q15 — Basic combat](
  #q15-what-does-basic-combat-need-to-prove)
- **Resolved:** [Q16 — Player feedback](
  #q16-what-feedback-does-the-player-need)
- **Resolved:** [Q17 — Minimap](#q17-what-role-does-the-minimap-play)
- **Resolved:** [Q18 — Animation examples](
  #q18-what-animation-examples-belong-in-the-slice)
- **Resolved:** [Q19 — Vertical-slice boundary](
  #q19-what-is-explicitly-inside-and-outside-the-vertical-slice)
- **Resolved:** [Q20 — Success criteria](
  #q20-how-will-we-judge-whether-the-slice-succeeds)
- **Resolved:** [Q21 — Special movement types](
  #q21-how-do-non-ground-and-special-movement-types-work)
- **Resolved:** [Q22 — Oversized mobile structures](
  #q22-how-do-oversized-mobile-structures-occupy-terrain)
- **Resolved:** [Q23 — Stealth and detection](
  #q23-how-do-stealth-and-detection-interact-with-vision)
- **Resolved:** [Q24 — Unit promotion and veterancy](
  #q24-how-do-unit-promotion-and-veterancy-work)
- **Resolved:** [Q25 — Campaign onboarding and difficulty](
  #q25-how-do-campaign-onboarding-and-difficulty-work)
- **Resolved:** [Q26 — Repair and healing](
  #q26-how-do-repair-healing-and-health-recovery-work)
- **Resolved:** [Q27 — Building upgrades](
  #q27-how-do-building-upgrades-work)
- **Deferred:** [Q28 — Mod support](#q28-how-does-modding-work)
- **Current:** [Q29 — NPC AI](#q29-how-should-npc-ai-work)
  M0 wildlife is resolved; remaining faction foundations are current.

## How we will use this

- Work on only the current question unless an answer naturally settles a later
  one.
- Treat answers as drafts until their question is marked resolved.
- Add newly discovered choices under that question's follow-ups.
- Record dependencies when one answer constrains another question.
- Update the table of contents when a question's state changes.
- Preserve useful rejected alternatives when the reason may matter later.
- Distinguish whole-game decisions from Milestone 0 implementation choices.
  A simplification made for the prototype does not become a rule for the final
  game unless it is explicitly accepted at that scope.

Question states:

- **Current:** being discussed now.
- **Queued:** waiting on earlier answers.
- **Drafted:** has an answer but still has unresolved follow-ups that affect it.
- **Resolved:** its main answer is ready to summarize in `DESIGN.md`; explicitly
  deferred adjacent questions may remain.

Decision scopes:

- **Game-wide:** intended to guide the complete game.
- **M0-only:** selected to build or evaluate the prototype without constraining
  the final design.
- **Working assumption:** useful for current discussion but open to revision.
- **Deferred:** deliberately left for a later design pass.

## Consistency audit — 2026-09-21

No known contradiction remains among the resolved questionnaire decisions.
This audit corrected or clarified:

- M0 is canon-compatible but remains a standalone prototype mission rather than
  the canonical first campaign mission.
- Defeating all six wolves is the exact victory trigger; revealing every map
  tile is not an additional completion condition.
- M0 must prove weighted movement with slow rough terrain rather than leaving
  all terrain cost binary.
- Single-player pause and result rules apply to the standalone M0 mission as
  well as campaign missions.
- The opening factions are the human ARC expedition and the elven Circle
  pilgrimage. Older multi-peoples coalition language does not describe the
  campaign opening.
- Decorative water remains available for the UV-animation proof while water
  traversal remains outside M0.
- Finite M0 Materials tiles now match the four resource-depletion visuals.
- Movement profiles and occupancy layers are separate, so watercraft remain on
  the surface layer while air and subterranean actors use distinct layers.
- Q10-Q17 now use actor detection rather than terrain vision wherever selection,
  targeting, Follow, blocking, health bars, badges, or minimap icons require a
  live non-allied actor.
- Transport passengers retain stable identity, health, veterancy, and other
  persistent state while outside world occupancy.
- Mobile units and vehicles cannot be sold. Only eligible buildings and fully
  deployed actors use the health-scaled resale formula, correcting the earlier
  orphaned-Harvester sale option.
- Q21-Q23 remain outside M0, but their movement, deployment, transport,
  targeting, stealth, and detection models now define the required data
  boundaries for later work.
- Q26's repair and healing rules use the shared infrastructure-work pool
  without placing recovery systems in M0.
- Q27's mission-local building upgrades are distinct from campaign unlock caps
  and permanent research. Upgrade spending affects resale but not repair price.
- A completed building cannot repair and upgrade simultaneously, avoiding
  ambiguous healing and queue behavior when multiple infrastructure slots
  exist.
- Q28's modding foundation and package format are retained as locked decisions,
  while dependency, compatibility, and distribution details are explicitly
  deferred for revision alongside evolving data schemas.
- Q29 separates deterministic actor behavior, encounter coordination, and
  future strategic planning. M0 uses only the actor and wolf-pack layers; base
  building and attack planning remain deferred.

The project-level synchronization pass is complete:

- `DESIGN.md` and `README.md` now use the selected ARC, Circle, and Everwake
  identities rather than the earlier generic coalition premise.
- `DESIGN.md` incorporates the resolved decisions into their owning sections,
  including M0 persistence as an architecture gate.
- `ROADMAP.md` now schedules the expanded economy, construction, production,
  fog, combat, wolf AI, interface, persistence, responsive-browser, and
  verification work required for the playable slice. Early selection and
  movement spikes are distinguished from their production implementations.
- M0's starting Materials and roadmap both account for the Refinery and its
  separately paid first Harvester, avoiding an initial economy deadlock.
- The locked input design supersedes the prototype camera bindings for future
  implementation.

## Established constraints

The questionnaire starts from these existing decisions and does not reopen them
unless the vertical slice exposes a contradiction:

- The game is an approachable science-fantasy real-time strategy game.
- Its major playable powers are ARC and the Circle of Repose.
- Play emphasizes readable combined arms, positional tactics, scouting, and map
  control rather than extreme actions-per-minute.
- The long-term game uses a traditional base-building RTS loop.
- The world is rendered in 3D with an isometric/top-down strategy camera.
- Simulation is deterministic and separate from rendering and platform APIs.
- Content is data-driven.
- The prototype already has tile-based heightfield terrain and strategy-camera
  controls.
- The existing Milestone 0 roadmap requires individual and group selection,
  movement and pathfinding, terrain and structure blockers, a minimap, and the
  planned animation techniques. This questionnaire is exploring a broader small
  playable slice that also includes a minimal economy, construction, production,
  fog of war, and combat.

## Player and prototype direction

### Q1. Who is the player in this slice?

**State:** Resolved

Before choosing a scenario, define the role the player is inhabiting and whose
units they command.

#### Main question

Who is the player for the purposes of this short prototype, and which faction or
group are they commanding?

#### Prompts

- Is the player a named character, an unnamed field commander, or simply an
  abstract RTS commander?
- Does the slice use ARC, the Circle, or deliberately neutral prototype units?
- Are the units and location part of the actual world, or is this framed as a
  non-canonical testing or training space?
- How much of this identity must be communicated in the prototype itself?

#### Draft answer

- The player is an abstract battlefield commander rather than a named
  protagonist.
- At the start of the broader game, the player chooses the campaign of either
  playable faction. Once chosen, the player commands only that faction for
  the duration of that campaign's storyline.
- ARC is the more approachable campaign and is recommended to first-time
  players. The Circle assumes greater familiarity and is aimed at more
  experienced players.
- This campaign-complexity difference is separate from the selectable
  Easy, Normal, and Hard combat difficulty available to both campaigns.
- The two sides therefore need separate campaigns that show their respective
  perspectives on the shared conflict.
- This remains true after the factions ally: the other faction is controlled by
  an AI ally in single-player, while future cooperative play may give it to a
  second player.
- The technology campaign follows the human military expedition sent to
  investigate an alarming signal from the world.
- The magic-and-nature campaign follows an elven expedition that arrived first
  in response to a prophecy or similar mystical calling.
- Their meeting is humanity's first known contact with another intelligent
  people.
- Milestone 0 will focus on a small playable slice of one faction rather than
  representing both playable factions.
- ARC is the selected playable faction for Milestone 0.
- That slice should contain only the small ARC roster needed to exercise its
  game loop. Its purpose is to experiment with possible RTS interactions and
  discover what should be retained or left out of the larger design.
- Prototype units do not need to be final roster choices, but their designs
  should be credible early expressions of the faction they represent.

#### Resolved follow-up: How literally does M0 represent ARC's first foothold?

- M0 is a canon-compatible depiction of ARC's first foothold rather than a
  training simulation or a disconnected test arena.
- Its premise and faction behavior fit the real game world, but M0 is a
  standalone prototype mission rather than the canonical first campaign mission.
  Its exact map, events, encounter composition, balance values, and assets
  remain provisional.
- ARC identity is visible through its terminology, unit and building names,
  insignia, and industrial-military visual language.
- Final artwork, cinematics, voice acting, and explicit lore exposition are not
  required for M0.
- Placeholder assets are acceptable when their silhouettes and behavior still
  communicate the intended ARC role.

#### Alternatives and reasons

- Neutral test units remain possible for technical experiments, but the playable
  prototype should lean toward intended faction identity so its assets and
  interaction lessons remain useful.

#### Dependencies

This answer will shape the desired player fantasy, scenario premise, unit
presentation, terminology, and animation examples.

## Q1 supporting decisions

### Q1a. What are the factions called, and what are they?

**State:** Resolved

Develop working names and concise descriptions for both playable factions and
the world-antagonist forces. The names only need to be strong enough for clear
design discussion; a later naming pass can refine them.

#### Main question

What naming style should the three factions share: formal political names,
evocative titles, setting-specific invented names, or a deliberate mixture?

#### Draft answer

- **Anomaly Response Command (ARC):** Humanity is in the early stages of
  interstellar exploration when it detects an alarming signal or warning
  broadcast from this world. ARC, the military branch responsible for
  investigating anomalous signals and potential threats beyond explored space,
  is dispatched and encounters another intelligent people for the first time.
  Its battlefield identity centers on machines, explosives, artificial
  intelligence, and disciplined organization. Its acronym also evokes travel,
  connection, electricity, and a developing story.
- **Elven civilization:** The setting uses the familiar high-fantasy elf
  archetype so players can understand the people without extensive explanation.
  These elves are a post-industrial, interstellar civilization deeply attuned
  to nature. Their ships, vehicles, structures, and other creations are alive in
  a natural sense. Their specific culture, history, and technology remain
  original to this setting rather than copying a particular fantasy world.
- **The Circle of Repose:** The playable magic faction is the particular elven
  pilgrimage that reached the world before ARC, not elven civilization as a
  whole. Its prophecy directs the Circle to put "the Unquiet" to rest or make it
  quiet again. Its arrival or early activity appears to have triggered the
  threatening signal that drew ARC. As far as the Circle knows, ARC is the only
  other expedition to answer the warning. The short name "the Circle" contrasts
  with ARC: an arc is partial while a circle suggests wholeness, balance,
  natural cycles, and eventual alliance.
- **The Everwake:** The world's ancient inhabitants transformed themselves into
  deathless, recognizably demonic forms to escape mortality. Their
  transformation devastated the world, and the citadels were created or
  repurposed to imprison them. They regard the transformation as ascension and
  their containment as enslavement. The Circle's prophecy calls them "the
  Unquiet" and seeks to return them to repose. Their demonic presentation gives
  players an immediate dark-antagonist read without relying on a real-world
  religious origin or extensive exposition once they are revealed. Neither ARC
  nor the Circle initially knows what the Unquiet are, and the Everwake's nature
  is not revealed until the middle or later part of the story.
- **Central conflict:** The two expeditions compete after a tense first contact.
  ARC sees an unknown force interfering with a world that has broadcast a
  galactic-scale warning and seeks to secure and exploit the citadels as
  strategic assets that can expand human technology. The elven pilgrimage sees
  late-arriving outsiders tampering with the very sites it must use or protect
  to fulfill its prophecy and quiet the Unquiet. Each faction initially treats
  the other as the central antagonist while both investigate and exploit lost
  caches, technologies, and citadels. By the time they understand the Everwake,
  their conflict has already allowed the deeper crisis to progress too far to
  prevent cleanly.

#### Deferred campaign and worldbuilding questions

- Is "the Unquiet" the elven prophecy's own term, an English translation, or a
  later name shared by both factions?
- Which visual and linguistic motifs make each side recognizable without
  relying only on color?
- Did the world deliberately broadcast a warning, did an ancient alarm system
  activate automatically, or is the signal an unintended symptom of the
  antagonist waking?
- What are the citadels, and why can ARC exploit them while the elven pilgrimage
  believes they are necessary to quiet the Unquiet?

#### Relationship to the earlier coalition wording

- The newer first-contact premise supersedes the old description of the opening
  factions as existing multi-peoples coalitions.
- ARC begins as a human expedition. Humanity has not knowingly encountered
  another intelligent people before meeting the Circle.
- The Circle begins as an elven pilgrimage rather than a broad magic-and-nature
  coalition.
- Later alliances or newly encountered peoples may broaden either side, but the
  design does not assume such coalitions already exist when the campaigns open.

#### Civilization and expedition distinction

- The human playable faction is ARC, not humanity as a whole.
- The magic playable faction will be the prophecy-led elven expedition, not the
  entire elven civilization.
- "Elves" is the clear player-facing species description.
- The elven expedition's selected working name is the Circle of Repose, commonly
  shortened to the Circle.

#### Technology-faction name decision

- **Selected working name:** Anomaly Response Command (ARC). It sounds like a
  plausible human military organization, while its acronym is pronounceable and
  carries relevant secondary meanings.
- **Alternatives considered:** WARD overlapped with the world's magical wards;
  ECHO felt fitted to its acronym; ESC was credible but lacked a meaningful
  spoken word.

#### Elven-expedition name decision

- The expedition is a pilgrimage charged by prophecy with putting the Unquiet
  to rest.
- **Selected working name:** The Circle of Repose, shortened to the Circle.
  "Repose" expresses its prophetic mission. "Circle" contrasts with ARC through
  wholeness, balance, and natural cycles, and it quietly foreshadows the
  factions' eventual alliance.
- **Alternatives considered:** Repose alone provided the clearest contrast
  between motion and rest. Chord offered geometric and musical connections but
  was a counterpart to an arc rather than a strong faction identity.

#### World-antagonist name decision

- The beings are recognizable fantasy demons rather than figures from a
  real-world religion.
- **Selected working name:** The Everwake. They use this name for themselves and
  understand eternal wakefulness as liberation or ascension.
- **Outsider name:** The Circle's prophecy calls them the Unquiet and describes
  putting them to rest, but does not explain exactly what they are.
- **Selected origin:** They are ancient inhabitants who transformed themselves
  into deathless demonic forms. The transformation devastated the world, and
  the citadels now contain them.
- Their familiar demonic appearance and behavior communicate a dark or evil
  role immediately. Their belief that they ascended and were unjustly imprisoned
  leaves room for later characterization without obscuring their antagonist role
  once the reveal occurs.
- **Reveal timing:** Neither playable faction knows the Everwake's identity or
  nature at first. Their self-name and demonic forms become known only in the
  middle or later story. Until then, ARC and the Circle understand one another
  as the principal enemy.

**Depends on:** Q1 and the existing setting and faction identities.

**Affects:** scenario language, unit and structure concepts, interface symbols,
animation examples, campaign writing, and later art direction.

### Q1b. What does each faction call the player?

**State:** Resolved

The player remains an abstract battlefield leader, but each faction can address
that role in language that reflects its own culture and relationship to the
player.

#### Draft answer

- **ARC:** The player is addressed as "Commander." It describes functional
  authority at any force size without asserting the specific senior rank implied
  by "General."
- **The Circle:** The player is addressed as "Guide," or formally as "Guide of
  the Circle." The title presents leadership as trusted direction within a
  pilgrimage rather than military command.
- **The Everwake:** The Everwake call the opposing player "the Chainbearer."
  The title casts the player as the antagonist in their story: the latest
  inheritor and enforcer of the citadel system that imprisoned them, who would
  steal their inheritance, deny their ascension, restore their chains, or end
  their existence.

#### Deferred usage details

- Is this term only a form of address in dialogue and unit acknowledgements, or
  also the player's label in menus and objectives?
- Does the Circle have a formal leader, or is the player a temporary guide or
  first among peers?
- Should the Everwake use a generic address such as "Trespasser" before they
  recognize the player as the Chainbearer?

**Depends on:** Q1 and Q1a.

#### ARC-title decision

- **Selected title:** Commander. It works for the small Milestone 0 detachment
  and can scale to larger forces later without tying the player to a specific
  military rank.
- **Alternative considered:** General implied a senior rank and a larger,
  established command than the early ARC expedition requires.

#### Circle-title decision

- **Selected title:** Guide, or Guide of the Circle in formal use. It is
  immediately understandable, directly connected to a pilgrimage, and simple
  enough to use naturally in unit dialogue.
- **Alternatives considered:** Keeper suggested protection but overlapped with
  imprisonment; Steward sounded administrative; Heart was more culturally
  distinctive but less immediately clear; Anchor carried nautical overtones.
  First Voice was too reminiscent of the First Speaker in Isaac Asimov's
  _Foundation_ series.

#### Everwake-title decision

- The name is the Everwake's sincere description of their enemy, not merely an
  insult or an objective label supplied by the game.
- **Selected title:** The Chainbearer. It applies in either campaign and frames
  the protagonist as the latest wielder of the citadels and inheritor of the
  ancient system that imprisoned the Everwake.
- **Optional early address:** "Trespasser" may be used before the Everwake
  recognize the player's larger role.
- **Alternatives considered:** Jailer was direct but implied the player created
  the prison; Usurper and Silencer were faction-specific; Heretic implied a
  shared faith or former allegiance.

## Player experience and opening scenario

### Q2. What should the player feel they are doing?

**State:** Resolved

Define the immediate player fantasy and the qualities the interaction should
express, such as commanding, scouting, route planning, or coordination.

#### Main question

During this short ARC slice, what activity should make the player feel most like
a battlefield commander?

#### Draft answer

- Guiding directive: if this game had a tutorial mission, design the most
  minimal version of that mission that still showcases what the game is.
- Milestone 0 is not a literal tutorial. It is the minimum viable playable
  foundation for what a future tutorial could teach.
- A full scripted tutorial, gated steps, and polished onboarding presentation
  are not required for this slice. M0 does include a few simple contextual
  notifications and explanatory popups to prove those interface paths.
- The player should feel like a battlefield commander establishing a first
  foothold in an unexplored and potentially hostile area.
- The slice should exercise a compact version of the recognizable RTS arc:
  begin from a Command Center, establish resource collection, expand the base,
  train a force, explore the map, and engage an enemy.
- The slice is experimental. Its units, buildings, and mechanics should help us
  discover what is worth developing further and what should be left out.

#### Follow-ups discovered while answering

- The present roadmap does not include economy, production, fog of war, or
  combat in Milestone 0. Revise it after the questionnaire establishes the
  slice boundary.

**Depends on:** Q1.

### Q3. What is happening in the slice?

**State:** Resolved

Choose the small scenario that gives the commander a reason to establish a
foothold, explore, and confront hostile native wildlife.

#### Main question

Why has ARC arrived at this location, and what makes the area worth securing?

#### Draft answer

- ARC establishes its first foothold in an unfamiliar landing region as the
  expedition begins operations on the world.
- The scenario occurs before ARC's first direct encounter with the Circle. The
  player discovers the world from humanity's perspective without yet knowing
  another expedition is present.
- Neither ARC nor the Circle initially knows the other faction exists. Their
  first contact occurs later when both forces converge on the same citadel or a
  lost cache and come into conflict over it.
- Establishing the foothold requires gathering local resources, building a
  small base, training a small force, and exploring concealed terrain.
- Milestone 0 introduces no citadels, caches, Circle forces, or Everwake
  presence. Its only active sides are ARC and native wildlife.
- The slice ends when the Commander has explored and secured the local map by
  defeating its hostile wildlife.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q1, Q1a, and Q2.

## Resolved decision

### Q3a. Does Milestone 0 contain a citadel?

**State:** Resolved

#### Draft answer

- No. Citadels, lost caches, the Circle, and the Everwake remain outside M0.
- M0 exploration reveals terrain, resources, obstacles, and native wildlife.
- The first citadel's presentation is deferred to later campaign design.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q3.

## Resolved decision

### Q3b. What is ARC's first hostile contact?

**State:** Resolved

Choose a basic enemy for the prototype that exercises combat without revealing
the Everwake or introducing the Circle before first contact.

#### Main question

What local threat lets M0 exercise combat without introducing another faction?

#### Draft answer

- The M0 enemy is native wildlife, not the Everwake or anything controlled by
  them. Neither ARC nor the Circle discovers what the Unquiet are until the
  middle or later campaign.
- ARC and the Circle become each other's apparent main antagonist after their
  eventual first contact over a citadel or lost cache.
- The prototype's first hostile contact is native wildlife. It demonstrates the
  danger of the living world without revealing an organized enemy faction or
  connecting the encounter to the Everwake.
- Wolves are the selected native wildlife for M0. A lone wolf provides the
  first hostile discovery before a larger pack is found at its den.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q3.

## Resolved decision

### Q4. What is the player's immediate objective?

**State:** Resolved

Define the visible task and the exact condition that completes the slice.

#### Main question

After establishing a foothold, what must the Commander accomplish to finish the
prototype?

#### Draft answer

- The Commander completes the slice by securing the local map.
- Securing the map means defeating all six hostile wolves. Exploration is the
  practical means of finding them, not a separate requirement to reveal 100% of
  the playable terrain.
- No additional survey structure, ancient site, or story discovery is required
  to complete M0.
- Completing the objective does not end the session. The player may continue
  building, training, and exploring in free play.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q3 and Q3b.

## Failure and recovery

### Q5. What can impede the player or cause failure?

**State:** Resolved

**Scope:** Game-wide rules, represented in M0 where applicable

Define the minimum consequences needed to make resource use, production,
movement, and wildlife combat meaningful without overbuilding the MVP.

#### Main question

Can the player formally lose Milestone 0, and if so, what event causes the loss?

#### Draft answer

- There is no need for a timer or competitive enemy economy.
- Native wildlife can damage and destroy ARC units.
- ARC can train replacement combat units so losses do not leave the player
  unable to continue.
- A destroyed Harvester is not replaced automatically. The Materials Refinery
  can construct a new one, which takes time and costs Materials.
- If the player cannot afford a replacement, they must obtain Materials through
  another available source, such as loot, or sell an eligible completed
  building for up to its half-cost refund under Q8's health-scaled formula.
- **Hard defeat:** Destruction of the player's Command Center immediately loses
  the mission.
- **Hard defeat:** Failure of a mission-specific mandatory objective, such as
  allowing a protected location to be destroyed, immediately loses the
  mission.
- **Soft defeat:** Losing every Harvester without enough Materials to construct
  another may leave the economy unrecoverable.
- **Soft defeat:** The remaining forces may be too weak to make a mission
  objective realistically achievable.
- Soft defeat does not automatically end the mission. The player decides
  whether to search for an unconventional recovery, sell assets, or restart.

#### Follow-ups discovered while answering

- Once mission success is earned, it remains recorded for that session and for
  campaign progression where the mission belongs to a campaign.
- Choosing post-victory free play cannot turn the recorded victory into defeat.
- Destroying the Command Center after victory may end the free-play session but
  does not revoke completion or replace it with a loss.

**Depends on:** Q3-Q4.

## Resolved interaction loop

### Q6. What is the smallest repeatable interaction loop?

**State:** Resolved

Connect the MVP systems into one coherent loop rather than a series of unrelated
feature demonstrations.

#### Draft answer

1. Begin with the ARC Command Center operating at a fixed map location.
2. Use the starting Materials to place the Materials Refinery within the Command
   Center's support area.
3. Use its placement preview to choose a valid footprint and rotate the
   building before confirming construction.
4. Wait for its short automatic construction timer to finish. About ten seconds
   is the initial tuning target, not a locked duration.
5. Select the completed Refinery and spend the remaining starting Materials to
   produce its Harvester as a separate action.
6. Direct the deployed Harvester from the Refinery's garage to a nearby
   resource patch.
7. Have the Harvester gather Materials and return them to the Materials
   Refinery.
8. Spend the delivered Materials on the Field Barracks.
9. After its short construction timer, select it and train an armed Trooper.
10. Send the Trooper into concealed terrain to explore and navigate the map.
11. Train additional Troopers and Scouts while exploration continues.
12. Use Scouts' greater speed and sight range to reveal terrain, accepting their
    very low health as the trade-off.
13. Discover and fight one lone wolf along an initially concealed route.
14. Continue exploring until the force finds a den containing four normal
    wolves and one larger alpha wolf.
15. Defeat all six wolves to complete the M0 objective, after which the player
    may continue playing freely.

The repeatable core within that scenario is: gather, spend, expand the force,
explore, encounter resistance, and reposition or reinforce.

Milestone 0 requires two short construction steps: first the Materials Refinery,
then the Field Barracks. It also requires at least one resource trip,
Trooper production, scouting, exploration, and combat. Exact costs, build
times, training times, and enemy balance remain tuning values.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q2 and Q4-Q5.

## Resolved decision

### Q7. How is the Command Center established?

**State:** Resolved

Choose the smallest Command Center starting state that leaves room to test
ordinary building placement.

#### Candidate approaches

- **Pre-established:** The Command Center is operating when play begins.
  This is simplest but does not demonstrate establishment or placement.
- **Prefab landing:** The player chooses a valid site within a small landing
  area, then deploys a prefabricated ARC Command Center there.
- **Command vehicle:** A mobile command vehicle finds a site and transforms into
  the Command Center. This adds movement and faction character but also requires
  a deployable-unit mechanic.
- **Construction unit:** A starting builder constructs the Command Center using
  standard building rules. This is traditional RTS behavior but introduces the
  full construction interaction immediately.

#### Draft answer

- In M0, the Command Center is already operating at a fixed map location when
  play begins.
- The first Materials Refinery introduces footprint placement, rotation, terrain
  validity, and proximity to the Command Center instead.
- How the Command Center is established in the full game remains deferred.
- This supersedes the earlier M0 direction in which the player placed a
  prefabricated Command Center within a landing zone.

#### Follow-ups discovered while answering

_None yet._

**Depends on:** Q3-Q6.

## Resolved economy decisions

### Q8. How do resources, construction, and production work?

**State:** Resolved

Separate the full game's economy design from the intentionally smaller economy
implemented in Milestone 0.

#### Q8a. What resource does ARC collect in Milestone 0, and how?

**Scope:** M0-only working implementation

Define the smallest version of ARC's common-resource loop needed to test M0.

#### Draft answer

- Milestone 0 uses ARC's common resource, Industrial Materials, displayed in
  ordinary shorthand as "Materials."
- The player begins with enough Materials to construct the first Materials
  Refinery and then produce its Harvester as a separate action.
- A completed Materials Refinery begins with one empty Harvester slot. It may
  produce a new Harvester when that slot is empty; this costs Materials and
  takes time, including for the first Harvester.
- Each Materials Refinery supports exactly one assigned Harvester. Its Harvester
  slot must be empty before the center can construct a replacement, preventing
  players from producing extra Harvesters from a single center.
- Increasing harvesting capacity therefore requires another Materials Refinery,
  tying economic growth to additional cost, space, and network support.
- The player selects the Harvester and gives it a resource patch as its target.
  It travels there, gathers from the target tile and nearby resource-bearing
  tiles, returns a full load to its assigned Materials Refinery, deposits the
  Materials, and repeats automatically.
- A full Harvester load from a fully stocked resource tile takes 60 seconds to
  gather. Travel to the patch and back to the Refinery is additional time, so
  distant resource sites carry an automatic time and exposure cost.
- When no harvestable resources remain at or near its assigned patch, the
  Harvester stops and waits for the player to assign a new patch.
- Move or Stop commands interrupt the automatic cycle without discarding a
  partial load. The Harvester retains collected Materials onboard.
- When assigned a different resource patch while carrying Materials, the
  Harvester first returns to its assigned Refinery and deposits them, then
  travels to the new patch.
- If its assigned Refinery is sold or destroyed, the Harvester stops its
  automatic gathering cycle but remains controllable. It may still move, serve
  as a distraction, or be assigned to an empty Harvester slot at another
  Refinery. It cannot be sold while it is a mobile unit. It retains any partial
  load and can deposit it after the new assignment.
- In Milestone 0, Materials are the only resource required for construction.
  The prototype has no separate power, supply, fuel, components, or technology
  requirements.
- Ordinary Material loot or salvage may provide an alternate recovery source if
  harvesting stops. This is not an ancient cache and has no connection to the
  Everwake or the exotic resource tier.
- Exact costs, yields, and timing remain M0 tuning decisions.

#### Q8b. How closely related are the factions' full-game economies?

**Scope:** Game-wide

ARC and the Circle use three mechanically parallel resource categories. The
names, descriptions, and collection methods differ by faction, but the strategic
cost roles remain legible across both economies.

1. **Common construction resource:** Widely available and required to create or
   upgrade both buildings and units. ARC extracts local raw matter and processes
   it into industrial inputs such as metals, carbon composites, and silicon.
   The Circle cultivates or gathers renewable living output without killing the
   source organisms.
2. **Rare advanced resource:** Less common and required for selected high-level
   research, upgrades, or special units. ARC interprets it as an advanced
   technological material; the Circle understands it as a magical resource such
   as mana or resonance.
3. **Exotic relic resource:** Obtained only from relics, lost caches, and
   citadels. It is used only for exceptionally rare recreations or adaptations
   of Everwake capabilities.

The exotic tier does not appear in the resource UI and is not silently tracked,
stockpiled, or spendable at the beginning of the game. It becomes an economy
resource only after the mid-to-late-game Everwake reveal. Earlier encounters
with relics, caches, and citadels remain discoveries or story events rather than
sources of a visible exotic currency.

#### Common-resource collection roles

- ARC sends a **Harvester** unit to extract common resources and return them for
  industrial processing at a **Materials Refinery**.
- The Circle sends a **Cultivator** unit to nurture living sources and gather
  their renewable output without killing them. It returns that output to a
  **Lifebloom Conservatory**.
- ARC Harvesters do not construct buildings. Repair capability and the
  full-game scouting value of Harvesters and Cultivators remain undecided, as
  does whether Cultivators participate in construction.

#### Q8c. Does training an M0 unit also spend Materials?

**Scope:** M0-only

Yes. M0 Materials represent ARC's common construction-resource tier and pay for
both structures and units. The rare and exotic tiers do not appear in M0.

#### Q8c-1. How are collected resources stored?

**Scope:** Game-wide

- Each resource type uses a global faction stockpile and has no storage limit.
- Once a worker delivers resources or a unit collects ordinary loot, those
  resources are immediately available for spending anywhere the faction can
  issue a valid purchase or construction order.
- Refineries and other buildings do not create storage capacity.
- Selling, disconnecting, or destroying a building never removes resources
  already deposited in the global stockpile.
- The game will not add storage buildings or capacity management merely to cap
  accumulated resources; that upkeep would add annoyance without supporting
  the intended strategy.

#### Q8d. What are the faction-facing names for the common resource?

**Scope:** Game-wide

The name should make the contrasting collection philosophies clear without
changing the shared mechanical role.

- **ARC selected name — Industrial Materials:** A deliberately plain military
  and industrial label for raw organic and mineral matter processed into metals,
  carbon composites, silicon, and other manufacturing inputs. "Materials" and
  "Mats" are common short forms.
- **Circle selected name — Lifebloom:** Renewable generative force coaxed from
  living systems without diminishing or killing them. "Bloom" is the ordinary
  short form. Cultivators nurture living sources and gather only their renewable
  surplus.
- **Alternatives considered:** Vital Essence was clear but generic. Verdance was
  poetic but less immediately understandable.

#### Q8e. What are the faction-facing names for the rare advanced resource?

**Scope:** Game-wide; excluded from M0

This tier enables selected advanced research, upgrades, and special units. Its
name and collection method should signal rarity without being confused with the
hidden exotic Everwake tier.

- **ARC selected name — Strategic Catalysts:** Scarce substances that enable
  advanced industrial processes, specialized units, and high-level research.
  "Catalysts" is the ordinary short form.
- **Circle selected name — Ley Resonance:** Concentrated magical resonance
  from rare living or ley sites, used for advanced growth, special beings, and
  high-level attunements. "Resonance" is the ordinary short form.
- **Alternatives considered:** Rare Elements and Mana were immediately
  understandable but generic. Metamaterials sounded manufactured rather than
  gathered, while Aether was less connected to living systems.

#### Q8f. How are common and rare resources collected together?

**Scope:** Game-wide; rare yields are excluded from M0

- The same faction worker gathers both resource tiers: ARC uses Harvesters and
  the Circle uses Cultivators.
- Each resource site has a data-driven internal ratio of common to rare yield.
  ARC receives Industrial Materials and Catalysts; the Circle receives
  Lifebloom and Resonance from its equivalent sites.
- Safe starting sites are weighted heavily toward the common resource. Sites
  with better rare-resource yields appear farther away, in more dangerous or
  contested locations.
- Players therefore expand and contest territory to support advanced units and
  research without learning a second collection interaction.
- M0 sites yield only Materials, so the rare tier and mixed-yield behavior
  remain outside the prototype.

The exact ratio remains hidden simulation data. Players infer a site's value
from the resources it actually returns.

#### Resource-quality discovery

- A site's exact common-to-rare ratio remains hidden.
- Scouting does not assign an explicit quality grade. Players learn a site's
  value by collecting from it and observing the returned amounts of each
  resource.
- The first time a player encounters a mixed yield, a short contextual tip may
  explain that sites contain different proportions and that expansion can lead
  to better advanced-resource income.
- The tip explains the system rather than revealing a site's exact ratio. Later
  decisions should come from experimentation and comparison.
- M0 does not need this tip or mixed-yield feedback because its sites produce
  only Materials.

#### Q8g. Do resource sites deplete or recover?

**Scope:** Game-wide

This determines whether expansion is driven only by access to richer rare
yields or also by pressure on existing collection sites.

- **ARC:** Harvesters extract at a relatively high rate but eventually exhaust
  or permanently damage the source. Continued growth pushes ARC outward toward
  new sites.
- **The Circle:** Cultivators gather renewable output more slowly. A source has
  limited throughput and may enter a temporary dormant period when worked too
  heavily, but it recovers rather than being destroyed. Growth encourages the
  Circle to cultivate multiple sites.
- Both factions therefore need territory, but their pressure to expand reflects
  their contrasting relationship with the world.
- Exact rates, capacities, recovery times, and balance remain deferred.
- **M0 exception:** The prototype uses finite Materials tiles so harvesting can
  demonstrate the four visual depletion states selected in Q18. It does not
  need to model ARC's broader ecological damage rules or the Circle's dormancy
  and recovery cycle. Harvester loss can still create the soft-defeat state
  described in Q5.

#### Resolved Q8 follow-up: How are harvesting problems communicated?

- When a Harvester exhausts its assigned patch and nearby resources, an alert
  identifies the idle Harvester and asks the player to assign a new patch.
- An unassigned Harvester prompts the player to assign it to an empty Refinery
  slot.
- If the faction has no active Harvester but can afford one, an alert points to
  a connected Refinery with an empty slot and prompts the player to produce a
  replacement.
- If there is no functioning Harvester and no immediately affordable recovery,
  an **Economy Stalled** warning suggests finding Materials loot or selling a
  completed structure.
- Economy-stall warnings never declare a hard defeat. The player may continue
  searching for a recovery or choose to restart.
- A Harvester coming under attack produces a distinct high-priority warning,
  alert-history entry, and minimap pulse. Selecting the warning focuses the
  camera on that Harvester. Repeated damage is grouped to avoid alert spam.

#### Resolved Q8 follow-up: How is ordinary Materials loot collected?

- Any player unit, including a Scout, may collect an ordinary Materials cache.
- The Materials enter the player's global stockpile immediately on collection;
  the collecting unit does not need to carry them back to a structure.
- Future missions may introduce special cargo that requires a dedicated truck
  and escort, but that mechanic is outside M0 and is not a rule for ordinary
  resource caches.

#### Resolved Q8 follow-up: When are production costs paid and refunded?

- A unit's full resource cost is paid when it enters a production queue.
- The player cannot queue a unit unless the global stockpile can pay its full
  cost at that moment.
- Cancelling any unfinished unit returns its full resource cost, even if
  production has already begun.
- A completed production order cannot be cancelled. Any later sale of that
  actor is governed by the completed-actor sale rules below.

#### Resolved Q8 follow-up: Which completed actors may be sold?

- Mobile units and vehicles cannot be sold. This includes deployable actors
  while they are in mobile mode.
- Only completed stationary buildings and fully deployed mobile actors are
  eligible to be sold, subject to actor-specific and mission restrictions.
- This prevents a player from liquidating an engaged battalion or other mobile
  force during combat.
- The normal undamaged sale value is half of the actor's total invested
  resources: its construction cost plus the costs of all completed, installed
  upgrades.
- Damage reduces that refund in direct proportion to the actor's remaining
  health: `refund = 50% of invested resources × current health / maximum
  health`.
- The formula applies independently to every resource in the investment and
  rounds each result down. The refund cannot fall below zero. Campaign unlocks
  are not purchases and do not increase the sale value.
- Temporary shields, barriers, and bonus health do not increase sale value.
  The ordinary health fraction is clamped from zero to one.
- This is the game's concrete resale calculation even if a later repair system
  uses different prices. "Sell value minus repair cost" describes its intent
  rather than creating a dependency on repair mechanics.

#### Resolved Q8 follow-up: How long can a production queue be?

- Each production building may hold at most five outstanding unit orders.
- The limit includes the unit currently being produced, leaving up to four
  waiting orders behind it.
- Pausing production because of a disconnected support network preserves the
  active unit's progress and every waiting order.

#### Resolved Q8 follow-up: How do production rally points work?

**Scope:** Game-wide; represented in M0

- Each unit-production building has one persistent ground rally point.
- A newly completed unit exits the building and automatically moves to that
  point.
- The rally point is visible while its production building is selected.
- The player chooses **Set Rally Point** from the building's sidebar actions,
  then selects an explored, passable ground location by clicking or tapping.
- Without a player-defined rally point, completed units exit and idle beside
  the building.

The following full-game questions remain explicitly deferred and do not block
M0:

- Whether Harvesters or Cultivators can repair or serve as useful scouts, and
  whether Cultivators participate in construction.
- Whether the full game permits resource transfer or trading, formal ownership
  of collection sites, or a population or command cap.
- The exotic resource's name, collection method, and uses after its reveal.
- Exact mixed-yield ratios, site capacities, ARC depletion rates, and Circle
  dormancy and recovery rates.

Costs, yields, travel distances, collection rates, and build or training times
are M0 balance tuning rather than unresolved economy rules.

**Depends on:** Q4-Q7.

## Resolved roster and structure decisions

### Q9. Which units and buildings does the slice need?

**State:** Resolved

**Scope:** M0-only representatives of intended ARC roles

Choose the smallest ARC roster that exercises establishment, harvesting,
construction, production, exploration, movement, and combat.

#### Working roster

- **Command Center:** Central ARC structure already operating at a fixed
  location. "HQ" may be used as informal shorthand.
- **Materials Refinery:** The first player-built structure, resource drop-off
  point, and producer and assignment point for one Harvester.
- **Harvester:** Separately produced vehicle that travels between a resource
  patch and its assigned Materials Refinery.
- **Field Barracks:** The second player-built structure and producer of ARC
  personnel. "Barracks" is its short UI name.
- **Trooper:** Armed general-purpose soldier used for exploration and combat.
- **Scout:** Fast exploration specialist with extended sight and very low
  health.

All M0 ARC building and unit names are now selected.

#### Q9a. How does ARC construct other structures?

**Scope:** Game-wide ARC rule; represented in M0

- The Commander selects a structure from the construction interface and places
  its blueprint directly on valid terrain. No builder unit is required.
- Before confirming placement, the Commander can rotate the footprint and move
  it around the supported area to choose its position and orientation.
- Placement requires enough Materials to pay the structure's cost and a
  location within the construction-support radius of a completed friendly
  building.
- The Command Center provides the largest initial support radius. Every
  completed building provides a smaller support radius of its own, allowing the
  base to expand outward as a connected chain.
- A newly placed blueprint does not extend construction support. Its building
  becomes part of the support network only when construction finishes.
- The full construction cost is paid when the blueprint is placed. Construction
  then proceeds automatically for that structure's build time.
- The player may cancel an unfinished structure at any point for a full refund.
  This makes placement forgiving even if some construction time has elapsed.
- The player may sell, reclaim, or deliberately dismantle an eligible completed
  building. An undamaged building returns half of its construction and
  completed-upgrade investment; damage reduces that refund under Q8's
  health-scaled formula.
- Whether combat destruction leaves anything reclaimable is a separate decision
  from the player's deliberate sell or dismantle command.
- The Harvester remains a resource-collection unit and does not construct
  buildings.

#### Q9b. What happens when construction support is lost?

**Scope:** Game-wide ARC rule; represented in M0

- Every ARC building requires an unbroken chain of overlapping support areas
  back to the player's Command Center.
- A building without that connection stops operating and stops extending
  construction support. It cannot serve as a bridge for buildings farther down
  the chain.
- A disconnected building remains known and selectable to its owner but stops
  providing active vision until its connection is restored.
- Multiple valid paths provide redundancy. Compact layouts and protected,
  overlapping connections are therefore safer than a thin chain of structures
  sprawling across the map.
- Destroying or selling a connecting building can disable an exposed branch of
  the base, making base layout and defense tactically important.
- The interface must clearly show support coverage, broken connections, and
  disabled buildings so that shutdowns are understandable rather than
  surprising.

#### Q9c. What happens to interrupted progress?

**Scope:** Game-wide ARC rule; represented in M0

- Construction and production pause when the affected building loses its
  connection to the Command Center.
- Current progress is preserved and resumes automatically when the connection
  is restored.
- An unfinished, disconnected blueprint may still be cancelled for a full
  refund.

#### Q9d. Can the network activate remote structures?

**Scope:** Game-wide

- ARC can build relay stations to extend its control network beyond the main
  base toward strategically valuable locations.
- Some discoverable outposts or ancient structures can be claimed or brought
  online only after the player connects them to the network.
- Before the story reveal, ancient Everwake structures are presented to ARC as
  unknown or anomalous structures rather than identified as Everwake
  technology.
- This creates a deliberate tension between keeping a compact, defensible base
  and maintaining longer, more vulnerable connections to valuable remote
  infrastructure.
- Redundant relay routes can protect important remote structures from being
  disabled by a single broken link.

#### M0 scope decision

- Dedicated relay stations and claimable remote structures remain outside M0.
- The prototype uses only the support connections among its compact group of
  ordinary ARC buildings.
- Relay expansion can be introduced later, alongside outposts and unknown
  ancient structures, without complicating the MVP or introducing the
  Everwake-related layer prematurely.

#### Q9e. How is a destroyed Harvester replaced?

**Scope:** Game-wide ARC rule; represented in M0

- A completed Materials Refinery begins with one empty Harvester slot.
- The player may fill the slot by producing a new Harvester or assigning a
  surviving unassigned Harvester to the Refinery.
- Producing any Harvester, including the first one in M0, takes time and costs
  Materials. Harvesters are never supplied automatically or for free.
- Each Materials Refinery may have only one assigned Harvester. Its slot becomes
  available if that Harvester is destroyed or becomes unassigned.
- Producing more simultaneous Harvesters requires constructing more Materials
  Refineries.
- If current Materials are insufficient, the player may seek other loot or sell
  an eligible completed structure under Q8's health-scaled investment formula.
- Exhausting every apparent recovery option creates a soft defeat. The game
  continues until the player finds a creative recovery or chooses to restart.

#### Q9f. What is the resource building called?

- **ARC selected name:** Materials Refinery, paired with the Harvester.
- **Circle selected name:** Lifebloom Conservatory, paired with the Cultivator.
- "Conservatory" is the short UI name. It describes a place that nurtures and
  preserves living growth while maintaining a parallel resource-and-facility
  naming pattern with Materials Refinery.
- Naming the Circle building does not require its capacity and production rules
  to match the ARC Materials Refinery.

#### Alternatives considered

- **Bloomheart:** Emphasized living architecture but was less explicit about the
  building's economic function.
- **Cultivation Grove:** Read naturally but risked sounding like the resource
  site itself and repeated the Cultivator name.

#### Q9g. What is the ARC unit-training building called?

- **Selected name:** Field Barracks, shortened to Barracks in the UI.
- It trains Troopers and Scouts in M0 and remains broad enough to produce other
  ARC personnel roles later.
- Its plain military terminology fits ARC's institutional naming style.

#### Q9h. What is the ARC headquarters called?

- **Selected name:** Command Center.
- "HQ" may be used as informal shorthand in dialogue or design discussion.
- The name communicates its military role and its position at the root of ARC's
  construction-support network.

#### Q9i. What are the ARC personnel units called?

- **Trooper:** The armed general-purpose ARC soldier.
- **Scout:** The fast, fragile ARC exploration specialist with extended vision.
- Both names deliberately use plain military language and communicate their
  roles without additional explanation.

#### Q9j. What is the Circle's central structure called?

- **Selected name:** Heartgrove.
- It is the Circle counterpart to ARC's Command Center: a living, communal root
  from which the Circle's base grows rather than a military headquarters.
- **Alternatives considered:** First Grove emphasized settlement and growth but
  sounded less central. Circle Sanctum emphasized spiritual purpose but read
  more like a temple than the root of an entire base.

#### Q9k. What are the Circle's Trooper and Scout called?

- **Sentinel:** The Circle's basic armed protector and counterpart to the ARC
  Trooper.
- **Wayfinder:** The Circle's fast, far-seeing exploration specialist and
  counterpart to the ARC Scout. The name also reinforces the pilgrimage motif.
- **Alternatives considered:** Groveguard repeated the motif already carried by
  Heartgrove. Thorn Guard and Farwalker implied equipment or abilities not yet
  present in the unit designs.
- "Warden" was avoided because `DESIGN.md` already uses it as a role category
  for control, summons, and terrain manipulation.

#### Q9l. What is the Circle's personnel structure called?

- **Selected name:** Musterhall.
- It is the Circle counterpart to ARC's Field Barracks and prepares Sentinels,
  Wayfinders, and potentially other Circle personnel.
- "Muster" communicates assembling a force, while "hall" fits a familiar elven
  culture without repeating the grove motif from Heartgrove.
- **Alternative considered:** Muster Grove carried a stronger nature motif but
  overused "grove" within the small Circle structure set.

The initial ARC and Circle counterpart names are now complete.

**Depends on:** Q2-Q8.

## Controls and camera

Resolve the control scheme one interaction at a time so mouse gestures, camera
behavior, and command input remain compatible.

### Q10. How should selecting, commanding, and moving the camera work?

**State:** Resolved

Define the mouse and keyboard controls, including how selection and movement
commands coexist with camera pan, rotation, zoom, and minimap input.

**Depends on:** Q6 and Q9.

**Implementation note:** The prototype's current left-drag pan and right-drag
rotation bindings must change to support this design.

#### Draft input terminology

- A **click** presses and releases a button without moving beyond a small
  tolerance of a few pixels. The exact threshold remains a tuning and
  accessibility value.
- A **drag** presses a button, moves beyond that tolerance, and releases at a
  different location.
- A **primary click or drag** means the physical left mouse button or the
  corresponding touchscreen interaction.
- A **secondary click or drag** means the physical right mouse button or a
  platform modifier such as Control or Command combined with the primary
  button.
- Every action available through a secondary gesture must also have an
  on-screen path so the interface remains usable on touch devices and with
  alternate input methods.

#### Draft selection and command rules

- With no current selection, primary-clicking any friendly or currently
  detected non-allied unit or building selects it for inspection. The sidebar
  shows basic information and applicable actions.
- Primary-dragging creates a selection rectangle. On release, all friendly
  mobile units inside it are selected; buildings and hostile actors are not.
- An unmodified primary click on a friendly actor replaces the current
  selection.
- Shift-primary-clicking a friendly mobile unit adds it to or removes it from
  the selected mobile-unit group.
- Selecting a friendly building selects it alone. Buildings and mobile units do
  not form mixed selections.
- With friendly mobile units selected, primary-clicking empty terrain issues a
  move command.
- With friendly mobile units selected, the target under the pointer determines
  the default contextual command and reticle.
- Hostile units and buildings use **Attack** with a red combat reticle.
- Destructible natural obstacles use **Clear** with a distinct obstacle icon.
- Resource sites use **Gather** with the relevant resource icon.
- Loot and pickups use **Collect** or **Interact** with a noncombat icon.
- Primary-clicking the target issues that default command to capable selected
  units. The radial context menu exposes the same action explicitly.
- Reticles differ by icon or shape as well as color.
- Secondary-clicking a target opens a radial context menu around it. The menu
  includes the action that a primary click would have performed by default.
- A setting makes primary clicks on non-friendly targets open the radial menu
  with the default action highlighted. This is enabled by default on mobile.
- Moving beyond the drag threshold before releasing a secondary gesture pans
  the camera and suppresses the context menu.
- Shift-secondary-drag rotates the camera.
- Moving the pointer into a desktop screen-edge zone may also pan the camera.

#### Touch selection and panning

- A tap performs the primary-click action.
- A one-finger drag that begins on empty world terrain pans the camera.
- An on-screen box-selection mode changes a one-finger world drag into a
  selection rectangle.
- Mobile edge taps are not used for panning because they would conflict with
  primary tap commands near the edge of the screen.
- Secondary actions remain available through on-screen controls and the radial
  context menu behavior described above.

#### Deferred scope

- Minimap behavior is tracked separately in Q17.
- Queued-order behavior and its M0 scope are established in Q11.
- Control groups and double-click selection are deferred beyond M0 to a later
  control-design pass.

#### Resolved follow-up: How does friendly selection replacement work?

- An unmodified primary click on a friendly actor replaces the current
  selection.
- Shift-primary-click adds or removes a friendly mobile unit from the current
  mobile-unit group.
- Selecting a friendly building selects it alone. Buildings and mobile units do
  not form mixed selections.

#### Resolved follow-up: Which targets use attack versus interact commands?

- Hostile actors and buildings use Attack.
- Destructible natural obstacles use Clear.
- Resource sites use Gather.
- Loot and pickups use Collect or Interact.
- Each category has a distinct icon or shape and does not rely on color alone.

#### Resolved follow-up: How does the player cancel or clear selection?

Clicking empty terrain cannot clear a mobile-unit selection because it issues a
move command.

- Escape cancels an active placement or targeting mode first.
- Otherwise, it closes an open radial menu.
- Otherwise, it cancels an active camera Focus transition or Follow mode.
- Otherwise, it clears the current selection.
- If none of those actions applies, it opens the game menu. This pauses a
  single-player game but does not pause multiplayer.
- A Cancel or X button in the sidebar performs the same context-sensitive
  action for touch devices and other setups without a keyboard.

#### Resolved follow-up: Which modifier rotates the camera?

- Shift-secondary-drag performs manual camera rotation.
- With a physical right mouse button, this is Shift-right-drag.
- When Control or Command plus primary-drag emulates a secondary drag, Shift is
  added as the separate rotation modifier.
- Touch devices use on-screen rotation controls or camera presets instead.

#### Resolved follow-up: How does the player zoom?

- The mouse wheel zooms toward the world position under the pointer.
- A touch pinch zooms around the gesture's midpoint.
- On-screen plus and minus buttons zoom around the center of the view.
- Keyboard plus and minus keys provide the same centered desktop alternative.
- The camera respects its configured minimum and maximum zoom limits.

#### Resolved follow-up: Which camera presets are available?

- All presets retain orthographic projection.
- **Isometric:** The default gameplay view, looking diagonally across the grid.
- **Top-down:** A north-up planning view for placement and map awareness.
- **Grid view:** An oblique view aligned with a cardinal grid direction.
  Rotate-left and rotate-right controls cycle it through north, east, south,
  and west.
- **Reset View:** Restores the default isometric pitch and orientation after
  manual rotation.

#### Resolved follow-up: How do preset transitions behave?

- Switching presets or resetting the view uses a short ease-in-out transition,
  initially targeted at roughly 200 to 300 milliseconds.
- The transition preserves the current focal point and zoom while changing the
  pitch and orientation.
- New camera input interrupts the transition immediately.
- Reduced-motion mode makes preset changes immediate.

#### Camera focus and follow

- The existing `focusOnTile` behavior must change from an immediate retarget to
  a smooth ease-in-out transition. Reduced-motion mode may make it immediate.
- A one-shot **Focus** action can center the camera on a tile, unit, building,
  resource, loot item, or other world object without continuing to track it.
- A persistent **Follow** action keeps the camera centered on a moving target
  until follow mode is cancelled or loses a valid target.
- Focus and Follow are presentation behaviors. They do not affect deterministic
  simulation state.
- The sidebar or radial context menu may expose Focus and Follow when they apply
  to the current selection or target.

#### Resolved follow-up: What cancels Follow mode?

- Manual camera panning or focusing another target cancels Follow mode.
- Zooming, rotating, and switching camera presets remain available without
  cancelling Follow.
- Escape cancels Follow before it clears the current selection.
- If the target is destroyed or otherwise becomes invalid, Follow ends at its
  last valid position.
- If a hostile target is no longer detected, Follow ends immediately and cannot
  reveal its movement through fog of war or concealment.
- Tracking eases toward the moving target rather than rigidly locking the camera
  to every simulation update.

#### Resolved follow-up: How does keyboard and edge panning work?

- WASD and the arrow keys pan continuously while held.
- Directions are screen-relative regardless of camera rotation.
- Pan speed scales with zoom to cross a consistent portion of the visible area
  per second.
- Desktop edge panning is enabled by default and configurable in settings.
- Edge-pan speed increases slightly deeper into the edge zone, and corners pan
  diagonally.
- Edge panning pauses over interface panels and stops when the pointer leaves
  the game window.
- Keyboard camera bindings are ignored while a text field has focus.

#### Resolved follow-up: Which surface owns a pointer gesture?

- The surface under the initial press owns the gesture until release or
  cancellation.
- A gesture starting on an interface panel never selects, pans, or commands the
  world, even if the pointer moves outside that panel.
- A world gesture retains its purpose if it crosses over an interface panel,
  and releasing it does not activate the interface underneath.
- Pointer capture keeps the gesture coherent if it leaves the canvas.
- Window blur, pointer cancellation, touch cancellation, or Escape cancels the
  gesture without issuing its click or release action.

#### Resolved follow-up: How are camera controls presented on screen?

- A compact camera-control cluster sits near the minimap.
- Zoom-in and zoom-out buttons remain directly visible.
- A camera or view button opens a small panel containing Isometric, Top-down,
  Grid, and Reset View actions.
- Rotate-left and rotate-right buttons change the grid-facing direction.
- A draggable compass ring provides free rotation on touch as the alternative
  to Shift-secondary-drag.
- On smaller screens, the panel collapses back into the single camera button
  after use.

#### Resolved follow-up: When is a unit inside the selection box?

- M0 box selection includes a friendly ground unit when its stable,
  ground-level selection anchor projects inside the rectangle.
- Visible model bounds, weapons, effects, and animation poses do not affect the
  test. Merely grazing one of those bounds does not select the unit.
- Q21 extends this anchor-based test to selectable units on other occupancy
  layers and permits mixed-layer groups. M0 implements only the ground-level
  case.

## Movement and map questions

### Q11. How should actors move?

**State:** Resolved

Define the player-visible movement model, including turning, speed, destination
arrival, command replacement, and how groups spread around a target.

**Early direction:** Harvesters travel between their assigned Materials Refinery
and resource sites. Scouts move faster than Troopers and other ordinary M0
units; exact speeds remain tuning values. M0 actors use only an ordinary
surface movement profile and the surface occupancy layer.

#### Resolved follow-up: Is ground movement continuous or tile-locked?

- Ground units move smoothly through continuous world positions rather than
  stepping or snapping from tile center to tile center.
- The terrain grid may still support pathfinding, elevation, and traversability
  calculations, but it does not define exclusive occupancy slots for ordinary
  mobile units.
- Buildings, and potentially some world objects, use the terrain grid for
  placement, spacing, and occupancy.
- Multiple units, especially small ones, may occupy different portions of the
  same terrain tile at the same time.
- A future oversized or heavy unit may temporarily occupy terrain like a
  building. A mobile headquarters crawler is one possible example, but this is
  not an M0 requirement.

#### Resolved follow-up: How do friendly units avoid crowding each other?

- Friendly mobile units use soft local separation and steering instead of
  acting as hard blockers for one another.
- Units may compress briefly while passing, but should not settle in visibly
  overlapping positions.
- A group ordered to a shared destination spreads around it according to the
  units' physical footprints.

#### Resolved follow-up: How do units turn while moving?

- Turning behavior varies by locomotion type.
- Infantry and similar agile units turn quickly and smoothly.
- Vehicles turn more slowly so that their movement communicates greater weight.
- Units may begin moving while turning and need not face the destination
  perfectly before making progress.
- M0 does not require detailed momentum or vehicle-physics simulation.

#### Resolved follow-up: How do new commands replace or queue existing orders?

- A normal command immediately replaces a unit's current order and clears its
  pending order queue.
- Shift-command appends movement waypoints or actions to the queue in sequence.
- Touch and other keyboard-free setups provide a visible **Queue Orders** mode.
  The player enables it, chooses multiple destinations or actions, and presses
  **Done** to leave the mode.
- The queued route and actions have a visible preview.
- M0 requires ordinary command replacement but may defer queued orders and
  their interface.

#### Resolved follow-up: What happens when a destination is blocked?

- If an exact destination is blocked, units approach the nearest reachable
  valid position.
- If no meaningful route exists, the command is rejected with clear visual
  feedback.
- If a valid route becomes blocked during travel, affected units automatically
  calculate another route.
- If repeated attempts still fail, units stop and display a blocked indicator
  rather than jittering or retrying indefinitely.
- Every unit in a commanded group resolves its own nearby destination slot.

**Depends on:** Q6, Q9, and Q10.

### Q12. What terrain and objects are traversable?

**State:** Resolved

Define how slopes, cliffs, paths, water, map boundaries, structures, and other
actors affect movement.

Airborne, subterranean, waterborne, and amphibious movement remain outside M0.
Their game-wide traversal, selection, targeting, detection, transition,
transport, and interaction rules are resolved in Q21.

Oversized mobile structures and units that temporarily claim grid occupancy
also remain outside M0. Their movement, deployment, support, and lifecycle
rules are resolved in Q22.

#### Resolved follow-up: Is terrain traversal binary or weighted?

- In the full game, terrain defines both passability and a movement-speed
  modifier for each applicable movement class.
- Pathfinding compares estimated travel time rather than merely choosing the
  geometrically shortest route.
- A longer fast route, such as a road, may therefore be preferable to a shorter
  route across slow or rough ground.
- Terrain such as cliffs or deep water may be impassable to an ordinary ground
  movement class.
- M0 uses one ordinary ground movement profile, binary blockers such as cliffs,
  and at least one slow rough-terrain type so its shorter-slow versus
  longer-fast route choice proves weighted traversal.

#### Resolved follow-up: How do slopes become impassable cliffs?

- Terrain steepness supplies the default passability and movement cost.
- Each movement class may define its own maximum traversable grade.
- Steeper but traversable slopes progressively reduce movement speed. Terrain
  beyond a movement class's grade limit is impassable to that class.
- Map authors may override the calculated result for intentional features such
  as ramps, stairs, bridges, cliffs, or scenario barriers. The resulting rule
  must remain visually understandable to the player.
- M0 may use one shared ground threshold and clearly shaped cliffs.

#### Resolved follow-up: How does terrain type affect movement?

- Tiles have an authored terrain type in addition to their geometric slope.
- A movement class uses that type to determine its default passability and
  movement cost.
- For example, water blocks units on foot but may allow boats, floating or
  amphibious vehicles, and transports capable of carrying ground units.
- Future flying units may pass over ground obstacles and buildings according
  to the rules of their own movement layer.

#### Resolved follow-up: What is the scope of a tile's passable flag?

- Each tile has an authored **Surface Passable** override in addition to its
  calculated slope and terrain-type defaults.
- Disabling Surface Passable blocks all surface movement, including infantry,
  vehicles, and watercraft.
- Future airborne and subterranean movement use their own layer-specific
  passability and may cross a surface-blocked tile when their rules permit it.
- A separate **Out of Bounds** or playable-area mask blocks every movement
  layer and defines absolute map limits.

#### Resolved follow-up: When does a building block movement?

- Placement is invalid while a ground unit or hard obstacle overlaps the
  proposed building footprint.
- Confirming a valid blueprint immediately reserves its entire grid footprint
  and blocks ordinary ground movement.
- Cancelling construction immediately removes that blocker and provides the
  previously established full refund.
- Future flying units may pass over construction according to their own
  movement-layer rules.

#### Resolved follow-up: Can construction dynamically block a route?

- Starting or cancelling construction updates traversability immediately.
- Units whose active route is affected calculate another route using the
  blocked-destination behavior established in Q11.
- If no route remains, units may approach the nearest reachable position and
  then report that they are blocked.
- Defensive construction may intentionally close a route to a base or target.
  The game does not guarantee that an alternate route will remain available.
- Enemy construction is outside M0, but the movement design supports it for
  later missions and multiplayer.

#### Resolved follow-up: Can opposing mobile units pass through each other?

- Friendly units continue to use soft separation.
- Mobile units on opposing sides cannot overlap or pass through one another.
- An opposing unit acts as a local dynamic blocker rather than permanently
  marking its terrain tile as impassable.
- Only currently detected opponents affect route planning, preventing
  pathfinding from revealing actors hidden by fog of war.
- A unit that encounters an unexpected opposing blocker attempts a local
  detour. Whether it automatically engages is part of the later combat rules.

#### Resolved follow-up: How do stationary world objects block movement?

- Each object type declares its own blocking footprint for each relevant
  movement layer, separately from its interaction range.
- Buildings and substantial destructible obstacles block surface movement.
- The M0 Materials site has a blocked physical core. Its assigned Harvester
  stops within collection range instead of entering that core.
- Small loot and pickups do not block movement.
- Destroying, exhausting, or otherwise removing a blocking object immediately
  updates affected routes.
- An object's appearance must clearly communicate its physical footprint.

**Depends on:** Q9 and Q11.

### Q13. What situations must the test map contain?

**State:** Resolved

Lay out the routes, obstructions, unreachable areas, landmarks, objective, and
stationary structure needed to exercise the chosen movement rules.

**Early direction:** M0 starts with a fixed ARC Command Center, nearby Materials
site, enough supported space for the Materials Refinery and Field Barracks,
concealed routes for Trooper and Scout exploration, one lone wolf, and a den
containing four normal wolves and one alpha. Ordinary Material loot or salvage
may provide an emergency recovery path without introducing ancient caches.

#### Resolved follow-up: What is the M0 map's overall topology?

- M0 uses a compact branching layout rather than a linear corridor or open
  arena.
- The Command Center begins in a safe pocket near one edge of the map.
- The nearby area contains the initial Materials site and enough buildable
  space for the Materials Refinery and Field Barracks.
- The starting pocket opens into two or three routes that later reconnect.
- At least one route provides a meaningful detour around blocked or slower
  terrain.
- Hostile wildlife occupies the unexplored outer areas and does not threaten
  the base immediately.
- Distinct terrain landmarks help the player navigate after revealing the map.
- The layout is intended to test exploration and rerouting without becoming
  either overly linear or unfocused.

#### Resolved follow-up: How is hostile wildlife distributed across the map?

- M0 contains six wolves in fixed, reproducible locations rather than using
  random spawning.
- One lone wolf appears along an initially concealed path as the first discovery
  and introductory fight.
- A den farther into the map contains four normal wolves and one alpha wolf,
  providing the larger final fight.
- The den sits in a secluded mountain enclosure using the existing ranges,
  with a chokepoint entrance. The lone wolf guards the outside approach;
  sightlines and encounter ranges isolate its alerts from the den pack,
  including the alpha's longer detection range.
- The alpha is visually 25% larger than a normal wolf and has more health. It
  serves as the boss of the M0 mission; its exact health remains a balance
  value.
- One Trooper can defeat the lone wolf, but a Scout cannot. This establishes the
  Trooper as the basic combat unit without erasing the Scout's vulnerability.
- Defeating the five-wolf den pack, including its alpha, requires multiple
  Troopers. The exact viable force size remains a balance value.
- The encounters occupy separate portions of the branching map so completing
  the objective requires continued exploration.
- The lone wolf guards the optional ordinary Materials loot described below.
- Defeating all six wolves completes the objective.

#### Resolved follow-up: Which traversal situations must M0 demonstrate?

- The Command Center's safe pocket provides flat, buildable terrain.
- A gentle traversable slope demonstrates smooth movement across the
  heightfield.
- An obvious impassable cliff or ridge shapes the branching routes.
- A shorter route across slow, rough terrain competes with a longer clear route
  and exercises weighted route choice.
- One narrow passage tests group movement without becoming a severe choke.
- A visible but unreachable terrain landmark clarifies the playable boundary
  and helps with navigation.
- Water traversal and destructible route-blocking obstacles remain outside M0
  so the map does not become a collection of disconnected traversal tests.
  Decorative water may appear outside playable routes to retain the existing
  scrolling-UV animation example selected in Q18.

#### Resolved follow-up: Where is the optional recovery Materials loot?

- Ordinary Materials loot sits just beyond the lone wolf as the reward for the
  introductory fight.
- The loot contains enough Materials to cover roughly two to three additional
  Troopers. The exact quantity remains a balance value tied to Trooper cost.
- This is an ordinary supply or salvage cache, not one of the setting's ancient
  lost caches, and does not imply an Everwake presence.
- Receiving it before the den encounter lets the player reinforce, replace
  losses, or recover from some economic mistakes.

#### Resolved follow-up: What shape should the playable map boundary have?

- The underlying terrain remains a rectangular tile grid for straightforward
  storage, pathfinding, and editing.
- An irregular, roughly rounded playable mask sits inside that grid rather than
  exposing its geometric boundary as the playable-map outline.
- Rendered but impassable buffer terrain surrounds the playable mask. Natural
  features such as cliffs, ridges, and darkness conceal the raw grid edges and
  corners.
- Normal camera movement and zoom cannot expose the raw terrain boundary.
- The playable outline is not shaped to look rectangular from the default
  isometric angle because it must also work under camera rotation and top-down
  view.
- Whole-grid framing remains a developer tool. Normal fit-to-map behavior uses
  the explored playable extent instead.

**Depends on:** Q3-Q5 and Q7-Q12.

### Q14. How do exploration and fog of war work?

**State:** Resolved

Define what starts concealed, what units and buildings reveal, what remains
remembered after leaving vision, and what information the player gains by
exploring.

**Early direction:** The player must explore the map and unveil it through fog
of war. Explored terrain remains visible on the main map and minimap after ARC
units leave, but non-allied dynamic actors appear as live entities only while
detected. In M0, ordinary actors are detected through current vision. Scouts
move faster and reveal a larger area than Troopers but have very low health.

#### Resolved follow-up: Does terrain obstruct vision?

- Every unit and building has a base vision radius.
- Clearly designated cliffs, ridges, and substantial structures block line of
  sight within that radius.
- An elevated observer can see over lower obstructions when the sightline
  permits it.
- Small props, units, and decorative vegetation do not block vision unless
  explicitly designed and clearly presented as occluders.
- M0 only needs obvious occluders, such as its main ridge, rather than a complex
  visibility simulation.

#### Resolved follow-up: Do all actors have the same vision range?

- Vision range is an actor-specific value rather than a universal radius.
- Scouts have greater vision range than ordinary combat units.
- The Command Center has greater vision range than ordinary buildings by
  default, giving the starting pocket a useful initial view.
- Future dedicated structures, such as an observation tower, may have still
  greater vision. Such a structure is not part of M0's building roster.

#### Resolved follow-up: What visibility states can a tile have?

- **Unexplored:** The tile has never been within friendly vision and appears
  fully dark, revealing neither terrain nor map contents.
- **Explored:** The tile was seen previously. Its remembered terrain remains
  visible in a darkened or muted state, but current dynamic information is not
  shown.
- **Visible:** A friendly unit or building currently has line of sight to the
  tile. Terrain and permitted live information appear normally.
- The map begins unexplored except for the area revealed by the Command Center
  and any other starting friendly actors.

#### Resolved follow-up: How closely is the camera clamped to explored terrain?

- The camera's focal point is constrained to explored terrain with a small
  margin rather than requiring every viewport pixel to remain explored.
- The viewport may show a narrow strip of unexplored darkness at the frontier,
  signaling where exploration can continue.
- The player cannot pan far enough into that darkness for the entire view to
  become unexplored or lose their bearings.
- Camera bounds expand as exploration reveals more terrain without exposing the
  map's full size or outer boundary prematurely.
- The existing whole-map `fitToMap` behavior must either remain a developer
  tool or fit only the explored extent during normal play.

#### Resolved follow-up: Which objects remain remembered under fog?

- Friendly units and buildings remain known to their owner.
- Hostile mobile units and wildlife disappear immediately when current
  detection is lost.
- Previously observed enemy buildings remain as visibly muted, last-known
  silhouettes. Their health, construction state, and continued existence do
  not update until friendly detection returns.
- Resource sites, terrain landmarks, and discovered objectives retain their
  last-known state.
- Discovered loot remains marked at its last-known position but may be gone
  when the area is revisited.
- Last-known information must look distinct from currently detected live
  information.
- Non-allied mobile actors, including hostile, neutral, and local units,
  disappear when no longer detected. Discovered stationary non-allied
  structures retain only their last-known state.
- In M0, which has no concealment, this means wolves disappear outside current
  vision, while the Materials site, den, and discovered Materials loot remain
  remembered.

#### Resolved follow-up: Which building states provide vision?

- Blueprints and unfinished buildings provide no active vision.
- A completed building provides vision only while operational and connected to
  the Command Center.
- A disconnected building remains visible and selectable to its owner but stops
  revealing its surroundings.
- Restoring its connection restores its vision immediately.
- The Command Center is the network root and provides vision while functioning.

#### Resolved follow-up: Do allied players share vision?

- Allied factions and cooperative players contribute to one combined explored
  area and current-vision map.
- Last-known information discovered by one ally is available to the others.
- Shared vision does not grant control over allied units or buildings.
- If an alliance ends, live vision sharing stops, but terrain learned during
  the alliance remains explored.
- M0 contains no allies; this is a game-wide rule for later campaigns and
  cooperative play.

**Depends on:** Q3-Q6, Q9, and Q13.

### Q15. What does basic combat need to prove?

**State:** Resolved

Define the native wildlife, targeting and attack behavior, damage and
destruction, retaliation, and the minimum feedback needed for a meaningful
engagement.

**Early direction:** The player first fights one lone wolf, then later confronts
four normal wolves and one alpha at a den. The six-wolf composition is fixed
for M0, while health, damage, and other balance values remain tunable. The alpha
is 25% larger than a normal wolf, has more health, and serves as the M0 boss.
One Trooper must be able to defeat the lone wolf, while one Scout cannot. The
den encounter must require multiple Troopers, although the exact viable force
size remains a tuning value. This need not establish the final combat or
enemy-AI design.
If combat destroys the Command Center before the objective is complete, M0 ends
in hard defeat.

#### Resolved follow-up: When do Troopers attack automatically?

- An explicit **Attack** command makes a Trooper pursue the selected target,
  enter weapon range, and continue attacking it.
- An idle Trooper automatically engages a detected hostile within a modest
  acquisition radius, subject to a short chase limit around its idle position.
- An ordinary **Move** command prioritizes reaching its destination and does not
  make the Trooper chase incidental enemies.
- A moving Trooper may return fire against an attacker already within weapon
  range, but does not abandon its route to pursue that attacker.
- **Attack Move** is an important core command and is included in M0. Units move
  toward the chosen destination, engage detected hostiles encountered along the
  route, and resume moving after the immediate threat is resolved.
- Attack Move must have an explicit on-screen or radial-menu action for touch
  and keyboard-free input. Its keyboard binding remains to be chosen.

#### Resolved follow-up: What happens when target detection is lost?

- ARC attackers stop receiving the target's live position and travel toward its
  last-known location without tracking hidden movement through fog of war.
- If the target is detected again en route, the attack resumes.
- If the attackers reach the last-known position without reacquiring the
  target, they stop searching.
- Units executing Attack Move then resume their original route.
- Units that acquired the target automatically while idle return to their
  original post.
- Units given an explicit Attack command remain at the last-known position and
  await another command.

#### Resolved follow-up: How do wolves acquire and pursue targets?

- Each encounter has a home territory: the lone wolf's path area or the den.
- A wolf engages when it personally detects an ARC actor within its own sight
  range. Damage raises a local alert without revealing an unseen attacker.
- Wolves that observe another wolf become alerted investigate the position
  where that wolf stood when the alert began. Alerts propagate through
  individual sight and terrain sightlines.
- The alpha has a larger detection range than normal wolves.
- Wolves choose a nearby detected ARC actor rather than using sophisticated
  focus-fire logic.
- Wolves may attack any ARC unit or building they encounter but do not
  proactively seek the base beyond their territory.
- Wolves pursue only within a defined leash around their home territory.
- If personal detection of the pursued target is lost, pursuit ends and the
  wolf starts returning to its authored home.

#### Resolved follow-up: What are the M0 attack types?

- A Trooper uses a ranged rifle and briefly stops, faces the target, and fires
  on a fixed attack cadence.
- A valid shot deals fixed damage without an accuracy roll, critical hit, or
  random miss.
- A visible tracer communicates the shot, while the deterministic simulation
  resolves its damage immediately rather than simulating a travelling bullet.
- Terrain and substantial structures block line of fire. A Trooper moves to a
  valid firing position when necessary.
- Mobile actors do not block shots, preventing formation and friendly-fire
  problems in M0.
- A wolf must reach melee range, stop, face its target, and deal fixed damage on
  its own attack cadence.
- Neither side attacks while moving in M0.
- These are M0 simplifications and do not prohibit later weapon behaviors.

#### Resolved follow-up: Does damage persist after an encounter disengages?

- ARC units and buildings do not passively recover health in M0.
- M0 has no repair, healing, or downed-unit system. Damage remains until the
  actor is destroyed.
- Wolves retain damage while fighting or pursuing.
- After returning home and remaining out of combat for a short delay, wolves
  gradually regenerate rather than resetting immediately.
- Wolf regeneration is visible and tuned to discourage slowly chipping away at
  the den with an inadequate force.
- Dead wolves remain dead and do not respawn.

#### Resolved follow-up: What remains after an actor is destroyed?

- A destroyed mobile actor stops blocking movement immediately.
- A unit wreck or wolf corpse remains as non-interactive visual feedback for an
  initial target of roughly 60 seconds, then automatically fades and clears to
  prevent battlefield clutter. The exact duration remains tunable.
- M0 corpses and wrecks cannot be selected, looted, reclaimed, or used as
  cover.
- A destroyed building plays its collapse presentation and leaves non-blocking
  visual debris that also clears automatically.
- Once building debris clears, its former footprint is buildable again.
- Combat-wreck salvage remains a later game-wide decision rather than an M0
  mechanic.

**Depends on:** Q3-Q6 and Q9.

### Q16. What feedback does the player need?

**State:** Resolved

Define how selection, destinations, valid and invalid commands, assigned group
positions, paths, and objective completion are communicated.

**Early direction:** Feedback must distinguish objective completion, hard
defeat, disconnected buildings, paused progress, and warnings that may indicate
a soft-defeat economy without ending the mission automatically. Movement
feedback must also distinguish an unreachable order from a unit that becomes
blocked after beginning a valid route. Last-known objects under fog must be
visually distinct from objects currently in friendly vision. Move and Attack
Move require distinct cursors, destination markers, and route feedback. Combat
feedback must make rifle shots, blocked firing positions, melee strikes, and
damage application understandable.

#### Resolved follow-up: When are actor health bars visible?

- Selected or hovered actors always show a health bar.
- Actors include both units and buildings; buildings follow the same contextual
  health-bar rules.
- Every unit in a selected group shows its health bar.
- An actor taking damage or actively fighting shows a health bar, which fades
  shortly after combat ends unless another display condition applies.
- By default, a full-health or unchanged actor that is not selected, hovered,
  or actively fighting does not retain a health bar on screen.
- A hostile health bar appears only while that hostile is currently detected.
- A last-known silhouette under fog never displays current health.
- The sidebar shows exact current and maximum health for the primary selection.
- An **Always Show Health Bars** setting keeps bars visible for all friendly and
  currently detected actors while respecting fog and concealment.

#### Resolved follow-up: How is selection shown in the world?

- Units and buildings use a standard five-segment health bar above the actor.
  Segment dividers show 20% intervals, while the fill drains continuously rather
  than snapping between five discrete values.
- Health bars supplement rather than replace selection markers because bars may
  also appear for hovering, inspection, damage, or combat.
- A selected friendly unit has a subtle ground ring sized to its footprint.
- Every unit in a selected group shows a ring. The primary unit uses a thicker
  or double ring.
- A selected building uses corner brackets around its grid footprint.
- Hostile and neutral inspection use distinct segmented marker shapes instead
  of relying only on color.
- Hovering provides a lighter preview highlight before selection.
- The drag rectangle is visible, and eligible units preview-highlight when
  their selection anchors enter it.
- Selection indicators never reveal actors hidden by fog of war.
- Exact health appears in the sidebar for the primary selection.
- Moderately damaged actors use restrained, type-appropriate intermittent
  effects. Critically damaged ARC actors use stronger sparks, smoke, or fire,
  while biological actors use appropriate wounded presentation.
- At zero health, an actor enters its death or destruction animation directly;
  there is no separate dying gameplay state.
- Health-bar depletion and damage-effect intensity remain understandable
  without relying only on color.

#### Resolved follow-up: How does the game acknowledge a command?

- The pointer previews the contextual command with a distinct icon and shape.
- A valid command produces a brief world-space marker at its target.
- Move uses a neutral destination marker. Attack uses a red target marker.
  Attack Move uses a distinct aggressive destination marker and route style.
- Gather, Clear, and Collect use their established unique command icons.
- Selected units briefly show their assigned destination positions. Full route
  lines fade quickly to prevent persistent clutter.
- A short acknowledgement sound confirms an accepted command.
- An invalid command produces a crossed-out marker, distinct error sound, and
  concise reason.
- A unit that becomes blocked during execution shows a different warning above
  itself, distinguishing later failure from immediate command rejection.
- Command feedback uses shape and icon differences rather than relying only on
  color.

#### Resolved follow-up: What if only part of a group can perform a command?

- Capable units execute the command.
- Incapable units retain their existing orders rather than stopping.
- Before issuance, the cursor or radial action shows how many selected units
  are eligible, such as **3 of 5**.
- After issuance, incapable units briefly show an unavailable-action indicator.
- A concise message reports the partial result, such as **2 units cannot
  attack**.
- If no selected unit can perform the action, the command is rejected with the
  normal invalid-command feedback.
- Universal commands such as Move and Attack Move apply to every selected mobile
  unit that supports movement.

#### Resolved follow-up: What belongs in the sidebar?

- Desktop uses a persistent, collapsible right-side panel. Mobile presents the
  same content as a collapsible bottom sheet.
- The selection header shows the actor's name, faction, portrait or icon, type,
  exact health, and current state.
- The panel provides actions relevant to the current selection or target.
- A selected production building shows its current production progress and
  queue.
- A selected building shows its support-network connection and any paused or
  disabled state.
- A group selection shows its member icons and counts and identifies the
  primary unit.
- A persistent **Build** tab exposes construction independently of selection
  because ARC construction does not require a builder unit.
- With no selection, the panel shows a compact mission summary, current
  objective, and recent important alerts.
- Global resource totals remain in the main HUD rather than changing with
  sidebar context.
- The context-sensitive Cancel or X control stays in a consistent corner.
- The minimap and its camera-control cluster remain separate from the sidebar.

#### Resolved follow-up: What belongs in the top bar?

- The left side provides the game-menu button and current pause state.
- The game menu includes save, load, restart, settings, and quit or abandon
  actions. Save, load, and restart are required in M0.
- The center shows compact primary-objective text and progress, expandable for
  full details.
- The right side shows resource totals, elapsed mission time, and an alert
  indicator for important off-screen events.
- M0 displays only Materials. Later factions and tiers display their relevant
  known resources, while the exotic resource remains completely absent until
  its story reveal.
- Resource income rates appear in tooltips or expanded details instead of using
  permanent bar space.
- The timer measures active simulation time, excludes pauses and loading, and
  persists through saves.
- Alerts include attacks, completed construction or training, disconnected
  buildings, and blocked units.
- A Harvester coming under attack receives a distinct high-priority warning,
  alert-history entry, and minimap pulse because losing it can stall the
  economy. Repeated damage is grouped to prevent alert spam.
- Population, supply, or command-capacity information is added only if a later
  design adopts such a system.
- Selected-actor information, production queues, and network details remain in
  the sidebar.
- On smaller screens, the objective collapses to an icon and resources use
  compact symbols, while Menu and the timer stay directly accessible.

#### Resolved follow-up: How do single-player time controls behave?

- Opening the game menu through its button or Escape pauses a single-player
  game, including the standalone M0 mission.
- Opening the menu does not pause multiplayer; the interface must clearly warn
  that the game continues.
- The single-player top bar provides **Pause**, **half-speed**,
  **normal-speed**, and **double-speed** controls.
- Pause is tactical. The player may pan the camera, inspect actors, change
  selections, place blueprints, manage production, and issue commands while
  simulation is stopped.
- Orders and construction begin executing only when simulation resumes.
- Opening the menu remembers the previous speed. Closing it restores that speed
  unless the player had already paused manually.
- The displayed timer follows simulation time: it stops while paused and
  advances according to the selected speed.
- Fog, combat, construction, production, and other simulation state remain
  frozen while paused.
- Multiplayer hides or disables pause and speed controls. Its menu clearly
  states **Game continues online**.

#### Resolved follow-up: How is the ARC support network visualized?

- The network overlay appears while placing a building, selecting an ARC
  building, or enabling a persistent **Network View** toggle.
- Completed buildings display translucent ground areas for their support
  radii.
- Solid lines show active connection paths back to the Command Center.
  Additional solid branches make redundant paths visible.
- Broken paths use dashed lines and visibly mark their gaps instead of relying
  only on red and green.
- A disconnected building dims, powers down its lights or machinery, and gains
  a persistent world-space offline badge. The badge uses a power or lightning
  symbol with a broken or crossed shape and a warning color such as amber,
  yellow, or red, so its meaning does not depend on color alone.
- Its sidebar state reads **Disconnected**, explains that no path reaches the
  Command Center, and identifies paused construction or production.
- Connection loss and restoration generate alerts. Selecting one focuses the
  camera on the affected building.
- Simultaneous failures are grouped into one alert, such as **3 buildings
  disconnected**.
- Only the player's own support network is shown.

#### Resolved follow-up: How are objectives and mission results communicated?

- Objective changes produce a brief banner, sound, and alert-history entry in
  addition to updating the compact top-bar objective.
- Victory pauses single-player and opens a results panel with **Continue
  Playing**, **Restart**, and **Exit** actions.
- Choosing Continue Playing permanently preserves the victory. Later events
  cannot turn it into defeat.
- A hard defeat pauses immediately and offers **Restart**, **Load**, and
  **Exit**.
- Command Center destruction after victory may end free play but does not
  revoke recorded mission completion or campaign progress where applicable.

**Depends on:** Q4-Q15.

### Q17. What role does the minimap play?

**State:** Resolved

Define its visible information, camera indicator, navigation behavior, and
whether it can also be used to issue commands.

**Early direction:** The minimap permanently shows terrain the player has
explored. Non-allied actors appear as live entities only while detected. The
minimap must not reveal the full map boundary or extent before exploration.
Remembered stationary objects may remain marked, but must be distinguishable
from live information.

#### Resolved follow-up: What information appears on the minimap?

- Unexplored space is featureless darkness and does not reveal the full map
  outline.
- Explored terrain remains visible in a muted form, including known cliffs,
  routes, and landmarks. Currently visible terrain appears brighter.
- Friendly and allied units and buildings always appear, using different icon
  shapes for units and structures.
- Non-allied mobile actors, whether hostile, neutral, or local, appear only
  while currently detected by the player or an ally.
- Previously observed non-allied structures and other stationary objects use
  muted or outlined icons to communicate last-known information.
- Sensor contacts use generic coarse-location markers and never resemble fully
  detected actor icons.
- Discovered resource sites, loot, and objectives remain marked according to
  their last-known state.
- Important alerts briefly pulse at their world location.
- A rotated outline shows the current camera footprint.
- Icons use shape as well as faction or relationship color. Nearby units may
  cluster at low minimap scale to prevent clutter.
- Network connections and detailed health information remain off the default
  minimap.

#### Resolved follow-up: How does the player interact with the minimap?

- Primary-clicking or tapping an explored minimap location smoothly centers the
  camera there.
- Dragging the viewport outline continuously pans the camera.
- Ordinary minimap interaction never issues a command accidentally.
- While an explicit Move or Attack Move mode is active, selecting an explored
  minimap location issues that command instead of moving the camera. This works
  the same way with mouse and touch.
- Unexplored minimap space cannot be targeted or used to move the camera.
  Interaction clamps to the nearest explored frontier.
- Selecting an alert or known objective marker focuses the camera on its
  location.
- Explicit Attack requires a currently detected target. A last-known marker or
  sensor contact supports only location-based commands such as Move, Attack
  Move, or Attack Ground where available.

#### Resolved follow-up: Does the minimap rotate with the camera?

- The minimap remains north-up as a stable navigation reference.
- Terrain, icons, and labels do not rotate with the camera.
- The camera-footprint outline rotates to match the current view direction.
- A small heading wedge or arrow indicates which edge of the footprint is
  forward.
- The adjacent compass ring uses the same north reference.
- Camera presets and free rotation never rotate the minimap itself.


**Depends on:** Q10 and Q13-Q16.

### Q18. What animation examples belong in the slice?

**State:** Resolved

Choose examples that prove the required animation pipelines without expanding
the gameplay scope. Animation support includes scrolling and frame-sequenced
textures, skeletal actors and structures, independent animated objects, and
state-driven changes to tile graphics.

**Early direction:** Troopers require locomotion, turning, stopping, aiming,
rifle-fire, hit-reaction, and destruction or death presentation. Wolves require
locomotion, turning, melee strikes, hit reactions, and death presentation.
Units and buildings also need readable escalating damage effects without
creating excessive battlefield particle clutter.

#### Established animation capabilities

- **Animated textures:** Support both continuous UV motion, such as the current
  scrolling water, and discrete multi-frame texture clips. The two techniques
  remain independently configurable and may be combined when appropriate.
- **Skeletal animation:** Support mobile actors such as walking soldiers and
  running wolves. Buildings may also use skeletal or articulated animation for
  doors, machinery, antennas, and other motion that makes an operating base
  feel active or alive.
- **Independent animated objects:** Support short-lived effects and ambient
  objects that are neither actors nor terrain, such as muzzle flashes, visible
  projectiles, and birds flying through the scene. Rendering an effect does not
  give it simulation authority; gameplay-bearing projectiles still use
  deterministic simulation rules.
- **State-driven tile graphics:** A tile may visibly change when its simulation
  state changes. In M0, each harvestable resource tile has four visual states:
  **full**, **reduced**, **sparse**, and **exhausted**. The deterministic amount
  remaining selects the state through data-driven thresholds, whose exact
  percentages remain tuning values.
- Animation playback remains a rendering concern. Deterministic simulation
  selects meaningful states, such as moving, firing, operating, damaged, or
  depleted, without deriving gameplay timing from rendered frames.

#### Resolved follow-up: Which content proves each animation pipeline?

Choose the smallest natural M0 examples for each capability. The examples
should support existing gameplay rather than introduce another unit, terrain
system, weapon behavior, or encounter solely as a demonstration.

Selected M0 examples include:

- Keep the existing water UV motion as the scrolling-texture example.
- Use subtle wind movement through grass or low vegetation as the frame-based
  terrain texture example. This is a discrete multi-frame loop, independent of
  the water's UV scrolling.
- In M0, the Trooper and Scout share one humanoid skeleton, model, and base
  animation set. Idle, locomotion, turning, hit reaction, and death clips are
  shared; the Trooper also uses aiming and rifle-fire clips.
- Distinguish the two M0 infantry roles through different model scaling and
  coloring as well as their selection icons and statistics. Exact scale and
  color values remain presentation tuning. Final faction art may give them
  separate models without changing their shared animation interface.
- Use additional skeletal or articulated clips for wolves, the Harvester's
  working apparatus, and visible operating parts on ARC buildings.
- All M0 wolves share one rig with idle, walk or trot, run, turn, melee attack,
  hit-reaction, and death clips. Regeneration reuses the idle clip with a
  separate visual effect.
- The den's alpha uses the same wolf model, rig, and clips at 125% of normal
  visual scale. Its increased health comes from simulation data rather than a
  separate animation set.
- The Harvester has idle, movement, deploy-collector, harvesting-loop,
  stow-collector, unloading, hit-reaction, and destruction states. Wheel or
  track motion may be procedural, while the collection apparatus uses
  articulated animation.
- The Command Center uses a looping antenna or sensor-array animation.
- The Materials Refinery animates its garage doors, Harvester deployment and
  return, and unloading or processing machinery.
- The Field Barracks opens its doors when a completed unit exits.
- Active building machinery stops when the building is disconnected. An
  additional world-space power or lightning badge marks the building as
  offline, using both shape and warning color.
- Building damage uses the escalating effects defined in Q16, and destruction
  uses a short collapse animation.
- Building construction uses visible build stages rather than requiring a
  unique skeletal construction animation for every structure.
- Use a texture-frame muzzle flash attached to the Trooper's rifle.
- Render each rifle tracer as a short-lived independent visual object. Damage
  remains immediate simulation state and does not wait for the tracer.
- Include one simple ambient bird flight loop as the non-combat independent
  animated-object example.
- Change resource-patch tile art through the four locked fullness states as
  Materials are removed.
- A travelling thrown projectile remains a valid later example, but M0 should
  not add one because its rifle damage is resolved immediately and its tracer
  is visual feedback rather than a simulated projectile.

**Depends on:** Q1, Q3, Q9, Q13, and Q15.

### Q19. What is explicitly inside and outside the vertical slice?

**State:** Resolved

Turn the preceding answers into a firm scope boundary, including presentation
fidelity and excluded game systems.

**Depends on:** Q1-Q18.

#### Resolved M0 boundary

M0 includes:

- One standalone, single-player ARC prototype mission on the compact map
  defined in Q13, using Normal difficulty as its balance baseline.
- The fixed Command Center, Materials Refinery, Harvester, Field Barracks,
  Trooper, and Scout defined in Q9.
- Resource collection and depletion, construction, production, support-network
  behavior, exploration under fog of war, terrain-aware movement, and combat
  against the six native wolves.
- The camera, selection, commands, HUD, sidebar, minimap, feedback, pause, and
  time controls defined in Q10-Q17.
- The animation and state-driven presentation examples defined in Q18.
- Manual saves, quicksave, autosave, load, and restart using serializable,
  deterministic simulation state and data-driven scenario definitions.
- Browser and desktop-Tauri execution, plus landscape browser testing at phone
  and tablet viewports using touch-style input.
- Prototype-quality art with the required readability and essential gameplay
  audio.

M0 excludes:

- Canonical campaign progression, a full scripted tutorial, staged onboarding,
  the Circle, the Everwake, citadels, and ancient caches. A few basic
  contextual popups remain inside M0.
- Rare and exotic resources, research or technology trees, upgrades, relays,
  claimable remote structures, and population or command-cap systems.
- A competing faction economy, diplomacy, alliances, or sophisticated enemy
  strategy beyond the wildlife behavior defined in Q15.
- Repair, healing, combat-wreck salvage, veterancy, stealth, oversized mobile
  structures, and airborne, subterranean, waterborne, or amphibious movement.
- Difficulty variants, multiplayer, replays, native mobile builds, a map
  editor, mod-management tools, the modding console, production-final assets,
  cinematics, voice acting, a final soundtrack, and localization.

The M0 roster, map, wolves, assets, and pacing prove the intended systems but do
not commit the final campaign to that exact content.

#### Resolved follow-up: Does M0 include save, load, and restart?

- Save, load, and restart are required parts of M0 rather than later polish.
- Proving serialization is an architecture gate: the simulation model and map
  format must round-trip correctly before their shapes are treated as stable or
  substantial mission content is built on top of them.
- Immutable scenario definitions and mutable runtime snapshots remain separate,
  data-driven, and serializable without renderer or platform objects.
- Runtime objects use stable identifiers so relationships such as orders,
  targets, production, Harvester assignment, and objectives can be restored.
- Restart reconstructs the pristine scenario from its scenario definition. Load
  reconstructs a saved runtime snapshot. Both use the same model-validation
  and world-construction boundaries wherever practical.
- Platform services handle storage and file access, while the deterministic
  game core owns save data and reconstruction.
- Campaign-save fields and commit rules remain deferred to the campaign design.

#### Resolved follow-up: When and what does a manual save capture?

- A single-player game may be saved manually at any point rather than only at
  checkpoints.
- Opening the save interface pauses simulation before the snapshot is taken.
- A snapshot preserves the mission and map state, terrain mutations, remaining
  resources, faction stockpiles, fog exploration, actors, stable identifiers,
  positions, health, and destroyed state.
- It also preserves issued orders and targets, construction and production
  progress, production queues and rally points, Harvester assignment, cargo,
  patch and collection progress, support-network state, wildlife encounter and
  regeneration state, objectives, completion state, elapsed simulation time,
  and deterministic random state if randomness is later introduced.
- As the resolved post-M0 systems are implemented, mission saves also preserve
  occupancy-layer transitions, transport passenger identities, deployment
  modes and footprint reservations, veterancy, concealment state, temporary
  reveals, and authoritative sensor contacts or detection effects.
- Derived rendering objects, transient visual effects, cached paths, and
  platform handles are not saved. Loading reconstructs those from authoritative
  simulation data and re-plans active routes deterministically.
- Loading restores the saved simulation state but begins paused, allowing the
  player to inspect the situation before resuming.

#### Resolved follow-up: How are saves versioned?

- Every save uses a versioned envelope containing its save-schema version,
  game or content version, scenario identifier and version, save timestamp,
  and elapsed simulation time where applicable.
- M0 guarantees correct round-tripping within the same build.
- Cross-build migration is not required for M0, but incompatible saves must be
  detected and rejected with a clear explanation rather than loaded partially
  or incorrectly.
- Explicit schema versions provide a future migration boundary without forcing
  the initial prototype to support indefinite backward compatibility.

#### Resolved follow-up: Are mission and campaign saves separate?

- Mission saves and campaign saves use separate files and schemas.
- A **mission save** owns the complete runtime snapshot for one active mission,
  including the simulation details listed above.
- A **campaign save** owns longer-lived campaign progression and choices rather
  than embedding the active mission's world state.
- A mission save may reference its originating campaign through a stable
  campaign identifier, but that reference does not merge the two save formats.
- Exact campaign-save fields and the rules for committing mission results to a
  campaign remain part of the later campaign-structure design.

#### Resolved follow-up: How are manual mission saves organized?

- Manual mission saves appear in a list rather than a fixed set of numbered
  slots.
- The player may create multiple saves without an artificial in-game count
  limit; actual storage failures are handled explicitly by the platform
  service.
- Each save has a player-editable name and displays the mission name, save
  timestamp, and elapsed simulation time.
- The Load interface uses the same metadata and clearly distinguishes mission
  saves from separate campaign saves.

#### Resolved follow-up: Does M0 include quicksave and autosave?

- M0 includes one rolling **Quicksave**, available from both a keyboard shortcut
  and the game menu so it remains accessible without a keyboard.
- M0 includes one rolling **Autosave**, updated at major objective transitions.
- Manual saves, the quicksave, and the autosave are separate entries. Neither
  rolling save may overwrite a manual save.
- The Load interface labels each entry as Manual, Quick, or Auto.

#### Resolved follow-up: Does M0 include multiplayer?

- M0 and the following early milestones are single-player and offline only.
- Multiplayer networking, synchronization, lobbies, matchmaking, replays, and
  multiplayer-specific save or pause behavior remain outside their scope.
- The single-player campaign must be properly designed, implemented, and
  proven before the project begins multiplayer work.
- Deterministic simulation, stable identifiers, serializable state, and
  platform boundaries should avoid foreclosing multiplayer later, but M0 does
  not implement speculative multiplayer infrastructure.

#### Resolved follow-up: Is M0 a campaign mission?

- M0 is a standalone prototype mission launched from the single-player menu.
- It is not the canonical first ARC campaign mission and does not write campaign
  progression.
- Its structure demonstrates the minimum experience that a later tutorial
  mission should be able to support. M0 includes limited contextual help but not
  a gated sequence of tutorial instructions or staged onboarding.
- The M0 map, wolves, pacing, and prototype assets do not become commitments to
  final campaign content merely because they prove the required systems.

#### Resolved follow-up: What presentation fidelity does M0 require?

- M0 may use simple, reused, or prototype-quality models, textures, effects,
  and interface art rather than production-final assets.
- Prototype art must still provide readable silhouettes, faction ownership,
  selection, health, commands, movement, harvesting, construction, production,
  fog, combat, damage, disconnection, objectives, victory, and defeat.
- The animation examples and state changes locked in Q18 must function even if
  their source assets are temporary.
- M0 includes essential sounds for command acknowledgement, invalid actions,
  attacks, damage, alerts, objectives, victory, and defeat.
- Voice acting, cinematics, a final soundtrack, and localization remain outside
  M0.

#### Resolved follow-up: What platforms and input modes does M0 verify?

- M0 runs in the browser and desktop Tauri shell. Native iOS and Android builds
  remain outside the early milestones and are not required by the current tool
  environment.
- Desktop verification uses mouse and keyboard as the primary input.
- Browser verification also uses mobile compatibility or device-emulation mode
  with a constrained viewport and primary touch-style input: taps and touch
  drags, without depending on hover, right-click, or keyboard shortcuts.
- Core play and interface actions must remain reachable through their on-screen
  alternatives in this mode, including camera control, selection, commands,
  construction, production, pause, save, load, and cancellation.
- The responsive mobile presentation uses the bottom-sheet and compact top-bar
  behavior defined in Q16.
- Touch-style play targets landscape orientation. M0 verifies at least one
  compact phone-sized landscape viewport and one tablet-sized landscape
  viewport.
- Portrait orientation shows a prompt to rotate the device instead of trying
  to compress the full RTS interface into an unusable layout.
- Browser emulation validates interaction and responsive layout, not native
  packaging, platform services, performance, haptics, or store readiness.

#### Resolved follow-up: Does M0 include a map editor or mod tools?

- M0 requires data-driven, serializable scenario definitions that load without
  renderer-specific state.
- M0 scenarios may be authored directly as project data with developer-facing
  validation and test support.
- A player-facing map editor, mod browser, mod-packaging workflow, and modding
  console remain outside M0.
- Map-editor work is deferred until the project begins designing and producing
  full scenarios, when real authoring needs can shape the tool instead of an
  early speculative interface.

### Q20. How will we judge whether the slice succeeds?

**State:** Resolved

Write player-facing acceptance criteria for clarity, control, movement,
feedback, completion, and approximate play time.

**Early direction:** The player begins from a fixed, operating Command Center,
builds a Materials Refinery and Field Barracks, collects Materials with
a Harvester, trains Troopers and Scouts, explores and reveals the map, navigates
its terrain, and uses explicit Attack and Attack Move commands to fight hostile
native wildlife. The slice reports completion when the Commander clears the
playable map of hostile wildlife, but free play may continue afterward.
Destroying the Command Center before mission completion causes hard defeat. Soft
defeat conditions do not end the mission automatically.
M0 also succeeds only if saving, loading, and restarting reconstruct the map,
actors, player decisions, and mission state correctly.
Its core interface and actions must also remain usable in a constrained browser
viewport with touch-style input and no keyboard, hover, or right-click.

#### Resolved follow-up: How long should M0 take to play?

- A first successful completion should take approximately 15 to 25 minutes.
- A player familiar with the scenario and controls should be able to replay it
  in roughly 10 to 15 minutes.
- These are experience targets rather than hard timers. M0 does not impose a
  mission time limit, and post-victory free play may continue indefinitely.

#### Resolved follow-up: How clear must M0 be without a tutorial?

- An RTS-familiar player who has not seen the project before should be able to
  complete M0 without developer guidance or external instructions.
- Objective text, cursor states, placement previews, alerts, notifications,
  sidebar actions, and other feedback should communicate what the player can do
  and why an action succeeded or failed.
- M0 includes a few simple, dismissible contextual popups that briefly explain
  what an important object or mechanic is and does.
- These popups prove the notification and modal interface paths. They do not
  gate actions, enforce a tutorial sequence, or attempt final onboarding polish.
- M0 uses two explanatory popups:
  - **Support Network** appears when the player first begins placing the
    Materials Refinery. It explains valid proximity and that disconnected
    buildings pause.
  - **Harvester Operations** appears when the first Harvester is produced. It
    explains patch assignment, automatic return trips, depletion, and
    reassignment.
- Combat, objective, attack, completion, and economy events use the normal
  notification and alert system instead of additional explanatory popups.

#### Resolved follow-up: How do popups differ from notifications?

- Ordinary notifications and alerts are non-modal and never pause simulation.
- The two explanatory popups pause single-player until the player dismisses
  them.
- Whether each popup has been dismissed is authoritative mission state and is
  included in manual, quick, and automatic mission saves.
- Loading does not repeat a popup that had already been dismissed in that
  snapshot.
- Restarting reconstructs the pristine mission state, so both popups may appear
  again during the new run.

#### Resolved M0 acceptance checklist

- **Entry and objective:** The standalone M0 mission launches from the
  single-player menu with its fixed Command Center, clearly states that the map
  must be secured from hostile local wildlife, and can be completed without
  developer guidance by an RTS-familiar first-time player.
- **Economy and base:** The player can separately construct a Materials
  Refinery and its Harvester, automate harvesting and delivery from a finite
  patch, construct a Field Barracks, and produce Troopers and Scouts. Placement,
  support-network failure, queues, rally points, cancellation, sale, loot, and
  recovery behave according to Q8-Q9.
- **Control:** Single, additive, and drag-box selection; contextual commands;
  Move; Attack; Attack Move; Gather; Collect; construction; production; camera
  control; pause; and time controls all provide their required feedback and
  have on-screen paths where required by Q10 and Q16.
- **Movement:** Units move smoothly rather than snapping between tile centers,
  respect terrain and stationary blockers, separate from other units, route
  around the map's test situations, recalculate when the world changes, and
  report immediately unreachable or later-blocked destinations distinctly.
- **Exploration:** Unexplored, explored, and currently visible space remain
  distinguishable. The camera cannot become lost beyond explored space, and
  the north-up minimap presents and navigates only information allowed by Q14
  and Q17.
- **Combat:** One Trooper can defeat the lone wolf while one Scout cannot. The
  four normal den wolves and 125%-scale alpha require multiple Troopers. Wolves
  follow their aggression and leash rules, damage remains deterministic, and
  defeating all six completes the objective.
- **Feedback and presentation:** Health, selection, commands, invalid actions,
  damage, destruction, disconnection, Harvester danger, objectives, victory,
  and defeat are understandable through the visual, audio, alert, notification,
  and popup paths defined in Q16 and Q20.
- **Animation:** Scrolling water, frame-animated vegetation, skeletal and
  articulated actors and buildings, the muzzle flash, tracer, ambient bird,
  damage effects, building stages, and four resource-depletion visuals prove
  the animation paths selected in Q18 without controlling simulation timing.
- **Persistence:** Manual saves, quicksave, and autosave round-trip the complete
  authoritative mission state within the same build. Loading begins paused,
  restart reconstructs the pristine mission, and incompatible versions fail with
  a clear explanation rather than corrupting state.
- **Platforms and layout:** The slice runs in the browser and desktop Tauri
  shell. Its core actions remain usable in compact phone and tablet landscape
  browser profiles with touch-style input and no keyboard, hover, or
  right-click. Portrait mode requests rotation.
- **Outcome:** Victory pauses and offers Continue Playing, Restart, and Exit.
  Command Center destruction before victory produces hard defeat, while soft
  defeat conditions remain player-judged. A recorded victory cannot be revoked
  during free play.
- **Duration:** A first successful run normally takes 15 to 25 minutes; a
  familiar replay normally takes 10 to 15 minutes. Neither is a hard timer.

**Depends on:** Q19.

### Q21. How do non-ground and special movement types work?

**State:** Resolved for the game-wide movement model; excluded from M0.

Define the purpose and rules of airborne, subterranean, waterborne, and
amphibious movement. Cover traversal, selection, targeting, fog of war,
transitions between layers, carrying ground units, and interactions with ground
actors and structures.

These unit types are outside the M0/MVP scope and must not constrain its ground
movement implementation prematurely.

#### Consistency impact identified after M0 design

- Q12 already separates the surface passability override from future air and
  subterranean passability and gives stationary objects per-layer blocking
  footprints.
- The full movement model must distinguish a unit's terrain traversal profile
  from the occupancy layer on which it collides with other actors.
- World position, pathfinding, selection, group commands, targeting, vision,
  transport, and save data must not assume every mobile actor is an ordinary
  ground unit.
- M0 may implement only the ordinary surface profile, provided its data model
  uses explicit movement and occupancy definitions rather than hard-coded
  ground-only behavior.

#### Resolved follow-up: How are movement and occupancy represented?

- Every mobile actor has a data-driven **movement profile** and one active
  **occupancy layer**.
- The movement profile determines terrain access, maximum slope, movement-cost
  modifiers, and supported transitions. Examples include foot, wheeled or
  tracked vehicle, watercraft, amphibious, and hover profiles.
- The occupancy layer determines which actors and world footprints physically
  collide or block one another. The initial game-wide layers are **surface**,
  **air**, and **subterranean**.
- Watercraft and amphibious actors remain on the surface occupancy layer. Their
  movement profiles, rather than a separate water layer, determine whether they
  can traverse water, land, or both.
- Air and subterranean actors may occupy the same horizontal location as a
  surface actor because they use different collision layers.
- Actors on the same occupancy layer use that layer's normal friendly
  separation and opposing-blocker rules unless a unit explicitly overrides
  them.
- Buildings and stationary objects continue to define blocking footprints per
  occupancy layer. The Out of Bounds mask blocks every layer.
- Changing occupancy layers is an explicit simulation transition rather than a
  side effect of animation or rendered altitude.
- M0 implements only an ordinary surface movement profile, but stores these
  concepts explicitly so later movement types do not require replacing its
  actor or map model.

#### Resolved follow-up: How does airborne movement work?

- Airborne actors use one **air** occupancy layer. The initial design does not
  have tactical altitude bands.
- Airborne actors move continuously at an authored visual cruise altitude.
  Rendered altitude is presentation rather than another simulation or
  collision layer.
- Air movement profiles ignore ordinary surface terrain, slopes, and surface
  building footprints.
- Airborne actors still respect the map's Out of Bounds mask and authored air
  blockers or no-fly volumes.
- Actors within the air layer use its normal friendly soft separation and
  opposing hard-blocker rules. Air paths may otherwise be mostly direct, but
  must route around air blockers.
- Takeoff and landing are explicit occupancy-layer transitions for actors that
  support them. Landing requires a valid surface location for the actor's
  surface footprint.
- These rules are game-wide design. Airborne actors remain outside M0.

#### Resolved follow-up: How does subterranean movement work?

- Subterranean actors use one **subterranean** occupancy layer. The initial
  design does not have tactical depth bands.
- While burrowed, actors ignore ordinary surface obstacles but respect the
  Out of Bounds mask, impenetrable terrain, and authored subterranean blockers.
- Actors within the subterranean layer use its normal friendly soft separation
  and opposing hard-blocker rules.
- Burrowing and emerging are explicit occupancy-layer transitions. Emerging
  requires enough valid surface space and cannot occur beneath an occupied or
  blocking footprint.
- By default, subterranean and surface actors cannot attack or physically
  interact across layers. Particular units, weapons, or abilities may
  explicitly override this rule later.
- When given a surface destination, a subterranean actor paths to a valid nearby
  emergence point, emerges, and then completes the command on the surface.
- Detection and fog-of-war behavior for subterranean actors follow Q23.
- These rules are game-wide design. Subterranean actors remain outside M0.

#### Resolved follow-up: How do waterborne and amphibious actors traverse?

- Watercraft and amphibious actors remain on the surface occupancy layer.
- Watercraft movement profiles traverse water but not land. Amphibious profiles
  traverse both and cross valid shorelines automatically without changing
  occupancy layers.
- Movement speed and cost may differ between land, shallow water, and deep
  water for each movement profile.
- Shore cliffs and other authored edges may block transitions even when the
  terrain on both sides is otherwise traversable.
- Ordinary land actors cannot enter water unless their movement profile permits
  it or they are being carried by a transport.
- Watercraft must be created or deployed at a valid water location. The exact
  production method belongs to the relevant actor or structure definition.
- These rules are game-wide design. Waterborne and amphibious actors remain
  outside M0.

#### New requirement: Passenger transports and APCs

- The full game should support transports that carry mobile actors across
  terrain those passengers could not traverse independently.
- An armored personnel carrier (APC) that carries soldiers across different
  terrain is a planned use of this system.
- Transport and passenger behavior should be a reusable, data-driven capability
  rather than a special case for the APC. This permits later air, water, and
  faction-specific transports to share the same rules.
- Faction-specific transport implementations still require decisions.
- Passenger transports and the APC remain outside M0.

#### Resolved follow-up: How do transports carry mobile actors?

- A transport defines a capacity and the passenger categories it permits.
- The transport's movement profile determines which terrain it can carry those
  passengers across. For example, an ordinary APC may be land-only while an
  amphibious APC may cross water.
- Loading uses an explicit **Board** action. Eligible actors path to the stopped
  transport and enter when they reach its boarding radius.
- Loaded passengers leave world occupancy and pathfinding. They cannot attack,
  provide vision, or receive individual world commands, but remain visible in
  the transport's sidebar manifest.
- Boarding preserves each passenger as the same stable actor rather than
  replacing it with anonymous cargo. Current health, maximum health,
  veterancy, ownership, and other persistent actor state remain unchanged.
- Unloading restores that same actor to world occupancy. Ordinary boarding and
  unloading never heal, damage, promote, or reset a passenger.
- The transport manifest shows each passenger's health and veterancy rank, and
  save data preserves the passenger identities and their current state.
- **Unload** targets a location. Passengers appear in nearby valid positions
  that they can individually traverse. The command pauses or reports failure
  if there is insufficient valid space.
- A transport's own weapons and abilities determine whether it can fight while
  carrying passengers. Carrying passengers causes no universal combat penalty.
- Capacity, passenger restrictions, and boarding time are data-driven.
- This is a shared passenger system rather than an APC-specific mechanic.

#### Resolved follow-up: What happens when a transport is destroyed?

- Transport destruction triggers a deterministic emergency-unload attempt.
- Each passenger that emerges takes damage equal to 50% of its maximum health.
  A passenger that was already sufficiently wounded may therefore die.
- A passenger dies if there is no valid nearby position or if the transport is
  over terrain that passenger cannot occupy, such as infantry inside a
  destroyed watercraft.
- Surviving passengers are briefly stunned and cannot immediately move or
  attack. The duration is data-driven.
- A transport that is otherwise eligible for sale or reclaim must be empty.
  Ordinary mobile transports are not sellable under Q8's completed-actor sale
  rules.

#### Resolved follow-up: Can selection and groups span occupancy layers?

- A selected group may contain friendly mobile actors from multiple occupancy
  layers.
- Box selection includes selectable friendly mobile actors whose stable,
  layer-specific selection anchors project inside the rectangle.
- Each actor resolves a shared movement command using its own movement profile
  and occupancy layer.
- An actor that cannot reach a meaningful position near the destination stops
  and shows the existing blocked indicator without preventing the rest of the
  selected group from moving.
- Friendly burrowed actors remain selectable through a visible world marker.
- Loaded passengers are excluded from world selection and are managed through
  the transport's sidebar manifest.
- If selectable actors overlap under the pointer, the radial context menu lists
  them so the player can choose the intended actor.

#### Resolved follow-up: How does targeting work across occupancy layers?

- Every weapon or ability declares the occupancy layers it can target.
- Ordinary weapons default to surface-only. Anti-air, air-to-surface, and
  anti-subterranean capabilities must be explicit.
- Q23's detection rules must make a hostile actor targetable before an Attack
  command or automatic acquisition can select it.
- In a mixed selection, capable actors execute an Attack command. Incapable
  actors remain in place and show an incompatible-target indicator.
- Attack Move considers only targets compatible with each actor's weapons.
- If a target changes to a layer an attacker cannot target, that attacker stops
  firing and follows the normal last-known-target behavior.
- Weapon range uses horizontal simulation distance. Visual air altitude does
  not alter deterministic range calculations.
- Cross-layer weapons and abilities may explicitly override the normal physical
  interaction rules without changing either actor's occupancy layer.

**Depends on:** Q10-Q17 and the broader unit and combat design.

### Q22. How do oversized mobile structures occupy terrain?

**State:** Resolved for the game-wide design; excluded from M0.

Define how large or heavy mobile actors, such as a possible mobile headquarters
crawler, transition between continuous movement and temporary building-like
grid occupancy. Cover placement validity, deployment, blocking, support-network
behavior, destruction, and whether the actor can operate while moving.

These actors and rules are outside the M0/MVP scope.

#### Consistency impact identified after M0 design

- Pathfinding must account for an actor's physical clearance rather than assume
  every mobile unit fits through the same passages.
- One stable actor identity must survive transitions between mobile and
  deployed states so health, selection, ownership, orders, and save data remain
  coherent.
- Deployment may reserve a tile footprint and participate in construction
  support, vision, production, and blocking; movement may need different rules.
- Q22 can extend Q9, Q11, and Q12 without changing ordinary M0 units or
  buildings.

#### Resolved follow-up: How do oversized and deployable actors differ?

- **Oversized** is a physical-size classification for any mobile actor whose
  authored selection area spans more than one square map tile.
- An oversized actor remains continuously positioned while mobile, but uses
  its larger physical footprint for collision and route-clearance tests.
- **Deployable** is a separate, data-driven capability. Only actors with that
  capability can anchor to the terrain grid and temporarily behave like
  structures; an actor need not be deployable merely because it is oversized.
- A deployable actor retains one stable identity, health, ownership, veterancy,
  and other persistent state while changing modes.
- Its mobile mode uses continuous occupancy. Its deployed mode reserves a
  grid-aligned footprint and blocks its occupancy layer like a building.
- Weapons, production, support, vision, and other functions may differ between
  the actor's mobile and deployed modes.
- M0 must allow actor clearance and selection areas to be data-driven, but does
  not include an oversized or deployable actor.

#### Resolved follow-up: How does deployment work?

- **Deploy** opens a grid-snapped footprint preview within a short distance of
  the selected actor.
- The player chooses a valid position and rotation. The actor moves into place,
  stops, aligns to the footprint, and begins a timed deployment transition.
- Placement validity checks terrain, slope, map bounds, blocking footprints,
  and any unit-specific support-network requirement.
- The actor reserves its full deployed footprint when the transition begins.
  Construction and other deployments cannot claim that footprint while it is
  reserved.
- A normal movement order may cancel deployment before it finishes. The actor
  returns to mobile mode without a resource penalty.
- Each deployable actor declares whether completed deployment is reversible.
  A permanently deployed actor may cancel before deployment finishes but cannot
  undeploy after the transition completes. The interface must communicate this
  consequence before confirmation.
- Undeployment also takes time. The actor retains its deployed footprint and
  deployed functions until that transition completes, then returns to
  continuous mobile occupancy. Support-network participation is the exception:
  it ends as soon as undeployment begins.
- Save data includes the actor's deployment state, transition progress,
  rotation, and footprint reservation.

#### Resolved follow-up: Which functions operate in each mode?

- Every capability declares whether it operates in mobile mode, deployed mode,
  or both.
- Movement is available only in mobile mode.
- Structure-like functions such as production, construction support, and
  support-network extension default to deployed-only.
- Weapons, abilities, and vision are defined individually. A crawler may, for
  example, retain basic defenses while mobile but unlock heavier systems when
  deployed.
- While deploying, an actor retains its mobile-mode capabilities but must
  remain stationary. While undeploying, it retains its other deployed-mode
  capabilities until the transition completes, but its support-network
  participation ends immediately.
- Taking damage does not automatically cancel a transition. An explicitly
  disabling or interrupting effect may do so.
- Persistent work such as a production queue pauses rather than being discarded
  while its required capability is unavailable.
- Attempting an unavailable action gives clear feedback such as **Requires
  deployment**.

#### Resolved follow-up: How does deployment affect the support network?

- A deployable actor's deployed mode declares one network role: **none**,
  **consumer**, **relay**, or **root**.
- Consumers and relays require an upstream connection. Roots establish a
  network without requiring one.
- Network participation begins when deployment completes and ends immediately
  when undeployment begins.
- Before confirming undeployment, the interface previews which connected
  buildings would go offline and warns the player.
- Losing support pauses deployed functions under the existing building rules,
  including production, active vision, and weapons.
- **Undeploy** remains available while disconnected so a reversible actor
  cannot become permanently stranded offline.
- Production queues and progress survive disconnection or undeployment and
  resume when the required deployed, connected state returns.
- Destroying a deployed network participant removes it from the network
  immediately and causes the network to recalculate as it would after an
  ordinary building is destroyed.

#### Resolved follow-up: How do oversized actors find and occupy routes?

- Every mobile actor has an authored movement-clearance footprint separate from
  its selection area.
- An oversized actor receives a route only if that clearance footprint can fit
  along the complete path.
- Mobile pathfinding uses a conservative circular or capsule-shaped clearance
  envelope to prevent large actors from catching on corners while turning.
  Deployed mode uses the exact grid-aligned footprint.
- Smaller friendly actors use soft separation and attempt to move aside for an
  oversized friendly actor, but cannot be pushed through obstacles or opposing
  actors.
- Oversized actors cannot force through undersized gaps, opposing actors, or
  blocking structures.
- If a route narrows or becomes blocked after movement begins, the actor
  recalculates it under the existing movement rules and reports that it is
  blocked if no valid route remains.
- Actors in a mixed group resolve paths independently. Smaller members may take
  a route that an oversized member cannot.

#### Resolved follow-up: How do destruction and sale affect deployable actors?

- Health persists across mobile, transitioning, and deployed modes. Deployment
  never repairs an actor.
- Destruction in any mode immediately cancels transitions and production,
  removes network participation, and releases every reserved footprint.
- The resulting non-blocking wreck or debris follows the existing cleanup
  rules for the actor's current mode and presentation.
- A mission may mark the stable actor identity as mission-critical. Destroying
  it causes hard defeat regardless of its mode. A mobile Command Center crawler
  therefore remains the same critical headquarters while moving.
- Mobile units, vehicles, and deployable actors in mobile mode cannot be sold.
  Only ordinary completed buildings and fully deployed actors are eligible.
- Selling is unavailable while an actor is transitioning, carrying passengers,
  or marked mission-critical.
- A permanently deployed actor may still be dismantled for the normal completed
  building refund unless its definition or mission rules explicitly prohibit
  that action.
- A damaged eligible actor has a lower sale value under Q8's completed-actor
  sale rules. Changing modes cannot change the underlying refund calculation.
- Combat destruction provides no refund. Any future battlefield-salvage system
  remains a separate design choice.

**Depends on:** Q8, Q9, Q11, Q12, and the broader roster design.

### Q23. How do stealth and detection interact with vision?

**State:** Resolved for the game-wide design; excluded from M0.

Define camouflage, invisibility, detectors, temporary reveals, and how hidden
actors interact with line of sight, last-known information, targeting, and
attacks.

Stealth and detection are outside the M0/MVP scope.

#### Consistency impact identified after M0 design

- Terrain visibility and actor detection must become separate concepts. A tile
  may be currently visible while a concealed actor on it remains undetected.
- Targeting, automatic attacks, Follow, pathfinding around opposing actors,
  health bars, world badges, last-known information, and minimap icons must all
  use detected-actor state rather than tile visibility alone.
- Fog exploration and terrain memory from Q14 remain valid. Q23 adds an actor
  observability test after terrain vision rather than replacing fog of war.

#### Resolved follow-up: How do terrain vision and actor detection differ?

- Fog tracks whether terrain is unexplored, explored, or currently visible.
- Each faction separately tracks whether every non-allied actor is currently
  detected.
- An ordinary exposed actor is detected while inside current friendly vision.
  A concealed actor may remain undetected on currently visible terrain.
- Only detected actors appear as live entities in the world, sidebar, minimap,
  targeting, pathfinding blockers, health bars, and veterancy badges.
- Losing detection creates last-known information under the existing fog rules.
  It never continues revealing live movement or health.
- Friendly actors remain known to their owner regardless of the camera position
  or fog state.
- Detection is deterministic. Save data includes temporary reveals and any
  other authoritative detection state that cannot be derived when loading.

#### Resolved follow-up: Which concealment categories exist?

- **Exposed:** The actor is detected normally within valid friendly vision.
- **Camouflaged:** A normal observer detects the actor only within a shorter
  proximity radius. A compatible detector can reveal it from farther away.
- **Cloaked:** Ordinary vision cannot detect the actor. Detection requires a
  compatible detector, an explicit reveal effect, or a defined cloak-breaking
  action.
- **Subterranean:** An actor on the subterranean occupancy layer is concealed
  from observers outside that layer unless they have compatible subterranean
  detection. This layer-derived category applies even when the actor's normal
  surfaced category would be Exposed.
- A subterranean actor's authored Exposed, Camouflaged, or Cloaked category
  still governs observers capable of viewing its layer. Returning to the
  surface restores that ordinary category.
- **Invisible** may be used as faction-specific presentation or terminology,
  but mechanically maps to Cloaked.
- Units and buildings may use any authored ordinary category their definitions
  permit. Subterranean concealment derives from the actor's active layer.
- Detection ranges and rules are authored and deterministic; perception never
  uses a random roll.

#### Resolved follow-up: Which actions temporarily reveal an actor?

- Attacking or using a hostile ability temporarily reveals a Camouflaged or
  Cloaked actor.
- Taking damage from an area effect or another valid non-targeted attack also
  temporarily reveals the actor.
- The reveal lasts for a short, data-driven duration after the latest revealing
  action. Three seconds is the initial balance baseline.
- Moving, boarding, and unloading do not inherently reveal an actor.
- An actor or ability may explicitly override these defaults, such as a
  specialist able to fire while cloaked.
- A temporarily revealed subterranean actor may be seen and tracked but still
  requires a weapon capable of targeting its occupancy layer.
- When the temporary reveal expires, the actor's ordinary camouflage, cloak,
  or subterranean rules resume. Opponents retain only the appropriate
  last-known information.

#### Resolved follow-up: What information does a detector provide?

- A detector declares its range, supported concealment categories, and
  occupancy layers.
- Compatible detector coverage combined with current terrain vision grants
  **full detection**. The actor becomes available normally for selection,
  targeting, pathfinding, and interface feedback.
- A detector explicitly designed to operate through fog may instead create a
  **sensor contact** without revealing the terrain.
- A sensor contact uses a generic marker at a coarse, deterministic location.
  It does not reveal actor type, exact position, health, veterancy, or selection
  details.
- A sensor contact cannot be targeted as an actor or followed. The player may
  issue an Attack Ground or area-effect command near it when their units support
  that command.
- Leaving compatible detector coverage removes full detection after a short,
  data-driven grace period that prevents boundary flicker. Ordinary last-known
  rules then apply.
- Operating a detector does not reveal its provider unless that actor or
  capability explicitly says otherwise.
- Units, buildings, temporary abilities, scripted map effects, and traps use
  the same detector-capability model.
- Radar, sonar, magical detectors, quantum locks, and traps are potential
  implementations with different ranges, layers, concealment compatibility,
  precision, and reveal effects.
- Detection upgrades may improve those properties or add support for additional
  detection kinds under Q27.

#### Resolved follow-up: How is detector compatibility calculated?

- Detection has no numeric power, strength, or level.
- Hidden actors expose one or more detectable signatures, such as visual,
  radar, sonar, magical, or quantum.
- A detector defines its supported signatures, concealment categories,
  occupancy layers, and range.
- Detection succeeds deterministically when those properties are compatible and
  the target is inside coverage. There is no random roll or hidden
  strength-versus-stealth comparison.
- If multiple channels cover an actor, one compatible channel is sufficient.
- Upgrades improve detection by increasing range, improving sensor-contact
  precision, adding concealment categories or occupancy layers, or adding new
  signature channels. They never raise a detection level.
- A quantum lock or similar advanced effect may force detection and prevent
  re-cloaking for a duration instead of applying a larger detection number.
- A trap may use the same compatibility model to trigger and reveal an actor
  that enters its local area.

#### Resolved follow-up: What happens on contact with an undetected actor?

- Undetected opposing actors and sensor contacts are excluded from a faction's
  route planning and known-blocker map.
- The authoritative simulation still prevents opposing actors on the same
  occupancy layer from physically overlapping.
- When opposing collision footprints make contact, a concealed actor is
  forcibly revealed to the contacting faction for the normal temporary-reveal
  duration.
- A newly detected actor becomes a hard local blocker. Affected moving actors
  recalculate their routes under the existing movement rules.
- Automatic combat behavior may engage the actor normally after it is revealed.
- This applies to Camouflaged and Cloaked units or structures. Subterranean
  actors do not trigger surface contact because they occupy another layer.
- A coarse sensor contact does not block movement. Only full detection or
  actual same-layer physical contact does.

#### Resolved follow-up: Do allies share detection?

- Allies share full detections, sensor contacts, and temporary reveals along
  with the shared vision established in Q14.
- A receiving ally does not need a matching detector of its own.
- A fully detected shared actor may be selected, targeted, and displayed
  normally. A shared sensor contact remains a limited contact.
- Ending an alliance immediately stops live detection and sensor-contact
  sharing.
- Terrain explored during the alliance remains explored under Q14.
- Previously learned stationary structures retain last-known silhouettes after
  the alliance ends. Mobile actors disappear unless independently detected.
- Shared detection provides information only. It does not grant control over
  the detecting ally's units or buildings.

#### Resolved follow-up: How do attacks interact with lost or absent detection?

- Direct Attack commands, automatic acquisition, and target-following weapons
  require full detection. A sensor contact or last-known silhouette is not a
  directly targetable actor.
- Losing detection ends live target tracking, but an attack that has already
  committed still resolves.
- A projectile already in flight follows its authored guidance rules. It does
  not receive updated hidden-position data unless explicitly designed to do so.
- The attacker otherwise follows Q15's last-known-position behavior.
- Weapons that support **Attack Ground** may fire at a valid location even when
  no actor is detected there. This includes ordinary explored terrain under fog
  and the coarse location of a sensor contact.
- A sensor contact is an explicit location-targeting exception when its marker
  lies over otherwise unexplored terrain. It does not reveal that terrain or
  permit arbitrary commands elsewhere in unexplored space.
- A location-targeted attack never snaps to or tracks an undetected actor.
  Hidden actors take damage when they intersect the weapon's authored impact,
  line, projectile-collision, or area-of-effect geometry.
- A weapon must support the target's occupancy layer to damage it. Ordinary
  surface fire therefore cannot strike a subterranean actor merely because it
  crosses the same horizontal location.
- Taking damage triggers the temporary-reveal rule. Until an impact occurs, a
  miss gives no confirmation that a hidden actor is or was nearby.
- Hidden actors must therefore avoid suspected blind fire, active crossfire,
  and area attacks rather than treating lack of detection as invulnerability.

#### Resolved follow-up: Does temporary reveal bypass fog or line of sight?

- An ordinary temporary reveal suppresses concealment but does not grant
  terrain vision or bypass line of sight.
- The revealed actor behaves as Exposed for the reveal duration. A faction
  still needs current vision to gain full detection.
- Damage outside current vision leaves the victim unidentified. The attacking
  faction receives only a coarse impact or combat ping at that location.
- An explicit advanced effect, such as an authored quantum lock, may state that
  it grants full detection through fog.
- Physical contact normally places the concealed actor within the contacting
  actor's vision, so contact-based forced reveal results in full detection.

#### Resolved follow-up: Does the owner know when concealment is detected?

- Friendly actors show their current concealment category in the sidebar and,
  when relevant, through a small world-status icon.
- A **Detected** indicator appears while at least one opponent has full
  detection of that actor.
- The indicator does not identify the opponent, detector location, detection
  channel, or coverage range.
- A forced-reveal effect displays its remaining duration.
- Merely becoming a coarse sensor contact does not notify the owner unless the
  detecting effect is explicitly observable.
- Detection changes use persistent status feedback rather than repeated
  notifications, preventing alert spam.
- Icons use shape as well as color and must remain legible alongside health,
  veterancy, selection, and offline-building indicators.

**Depends on:** Q14, Q15, and the broader roster design.

### Q24. How do unit promotion and veterancy work?

**State:** Resolved for the full game; excluded from M0.

Track combat contribution so surviving combat actors can earn offensive bonuses
and a visible rank through repeated kills during a mission.

#### Kill-credit rule

- The simulation tracks how much effective damage each eligible combat actor
  deals to every target.
- When a unit or building is destroyed, every eligible attacker responsible
  for at least 35% of its counted damage receives one kill credit.
- With contribution shares normalized against the same total effective damage,
  no more than two attackers can meet the 35% threshold for one target.
- If no attacker reaches 35%, no one receives kill credit. Sending a large
  group to overwhelm a trivial target therefore usually produces no veterancy
  credit.
- Destroying buildings counts as a kill for this system.

#### Promotion tiers

- **10 credited kills — one stripe (`/`):** +25% base damage, producing
  approximately +25% DPS.
- **25 credited kills — two stripes (`//`):** Retain +25% base damage and add
  +25% base attack speed, producing approximately +56.25% DPS.
- **50 credited kills — one chevron (`^`):** Increase the damage bonus to +50%
  of base while retaining +25% base attack speed, producing approximately
  +87.5% DPS.
- **100 credited kills — double chevron:** Retain +50% base damage and
  increase the attack-speed bonus to +50% of base, producing approximately
  +125% DPS.
- **200 credited kills — veteran star (`*`):** Increase both bonuses to +75%
  of base, producing approximately +206.25% DPS.
- All five ranks use purpose-made SVG interface icons: one stripe, two stripes,
  one chevron, two stacked chevrons, and a veteran star. No rank badge relies
  on font glyphs, keeping its shape consistent across platforms and fonts.
- Bonuses affect DPS only through damage, attack speed or cadence, or a
  combination of the two. They never increase movement speed, range, maximum
  health, or current health.
- Each new 25% step adds 25 percentage points of the unit's unmodified base
  stat rather than multiplying the already promoted stat.
- Attack-speed bonuses increase attacks per unit of time. They do not reduce
  the attack interval by the stated percentage, which would produce a larger
  and less intuitive cadence increase.
- Damage and attack-speed multipliers then combine normally, producing the
  approximate total DPS values above. These simple component steps supersede
  the earlier exact +25%, +50%, +100%, +150%, and +200% total-DPS targets.
- Promotions retain their earlier bonuses; neither damage nor attack speed
  decreases when a unit advances.

#### Resolved follow-up: What damage counts toward kill credit?

- Effective contribution is actual health removed, capped by the target's
  remaining health before the hit. Overkill damage does not count.
- Each damaged target maintains a contribution ledger representing its current
  unrecovered health loss.
- Healing removes contribution from that ledger proportionally across its
  contributors. Returning to full health clears the ledger completely.
- At destruction, each unit's percentage is calculated from the remaining
  ledger. Repeatedly damaging a target that heals therefore cannot inflate
  veterancy credit.

#### Resolved follow-up: Must the contributor survive the target?

- A destroyed contributor's effective damage remains in the target's ledger
  and in the denominator used to calculate contribution shares.
- A contributor that is no longer alive when the target is destroyed receives
  no veterancy credit or promotion.
- Its share is not removed or redistributed to surviving contributors.
- A later mission-statistics system may report posthumous contribution or kill
  credit, but that does not affect veterancy progression.

#### Resolved follow-up: Which actors can earn veterancy?

- Any persistent mobile unit or armed defensive structure may earn veterancy
  when it deals qualifying damage.
- A Scout, Harvester, or transport with no damaging weapon or ability cannot
  contribute and therefore cannot earn kill credit.
- Damage from an indirect weapon, deployed effect, or persistent hazard is
  credited to the combat actor that created it.
- A temporary summon does not maintain independent veterancy. Its qualifying
  damage is credited to its persistent summoner.
- A turret or other armed defensive building receives credit and promotions in
  the same way as a mobile combat unit. This makes repeatedly rushing cheap
  units into established defenses strengthen those defenses over time.
- Unarmed buildings cannot contribute, although all buildings remain eligible
  targets for attackers' kill credit.

#### Resolved follow-up: Does veterancy persist between missions?

- Veterancy is earned and used within one mission. It does not transfer from
  one campaign mission to another.
- Every newly produced or otherwise newly introduced actor starts with zero
  credited kills and no veteran rank.
- A mission definition or mission script may explicitly create a prebuilt actor
  with a specified kill count or rank when the scenario requires it. This is a
  deliberate content exception, not a general way to purchase or deploy new
  veteran actors.
- Mission saves preserve current kill counts and ranks because they are part of
  the active simulation snapshot.
- Restarting restores the mission's initial scripted values. Destroying an actor
  or selling an eligible building or fully deployed actor removes its current
  veterancy. Any replacement starts at zero unless explicitly scripted
  otherwise.

#### Resolved follow-up: How does veterancy combine with other modifiers?

- Veterancy damage and attack-speed multipliers combine multiplicatively with
  permanent upgrades, temporary buffs, debuffs, and faction-specific
  modifiers.
- For example, `1.25×` veteran damage and a `1.20×` weapon upgrade produce
  `1.50×` base damage.
- Multiplication keeps each effect proportional and makes the result independent
  of application order. Extreme combinations remain a balance concern rather
  than requiring a different veterancy rule.

#### Resolved follow-up: Where does the rank badge appear?

- Each promoted combat actor displays its SVG rank badge in world space at a
  consistent lower-right position beside the actor itself.
- The marker is visible for friendly veterans and for opposing veterans while
  they are currently detected. It never reveals an actor through fog or
  concealment.
- Showing an opponent's rank enables tactical decisions such as focus-firing a
  highly promoted unit or avoiding a veteran defensive structure.
- The same badge may also appear on selection icons and in the sidebar for
  inspection, but the world-space marker is required and authoritative for
  battlefield readability.
- Badge positioning must avoid obscuring health bars, selection markers, and
  offline-building warnings, and cannot rely on color alone.

**Depends on:** Q9, Q15, the broader roster design, and combat balance.

### Q25. How do campaign onboarding and difficulty work?

**State:** Resolved for the single-player game; M0 uses the Normal baseline.

#### Campaign onboarding

- ARC is the more approachable campaign and is recommended to first-time
  players.
- The Circle is designed for players with more RTS or game-system familiarity.
- This distinction concerns campaign complexity and faction learning curve, not
  an inability to choose difficulty independently.
- The campaign chooser labels ARC **Recommended First Campaign** and the Circle
  **Advanced Campaign**.
- Both campaigns remain immediately selectable; the labels advise rather than
  lock or gate either choice.
- Normal is initially selected for either campaign, but the player explicitly
  chooses Easy, Normal, or Hard before starting.
- Campaign choice and difficulty remain independent.

#### Difficulty modes

- Both campaigns and their individual missions support **Easy**, **Normal**, and
  **Hard**.
- **Easy:** Enemies use `sqrt(0.5)`, approximately 70.71%, of their Normal
  health and damage. The two factors combine to an approximately 50% combat
  effect in a symmetric damage race.
- **Normal:** Enemies use the baseline health and damage values.
- **Hard:** Enemies use `sqrt(2)`, approximately 141.42%, of their Normal health
  and damage. The two factors combine to an approximately 200% combat effect in
  a symmetric damage race.
- Other behavior should remain consistent unless a later decision explicitly
  adds difficulty-specific AI or scenario rules.
- M0 balancing and its one-Trooper-versus-one-wolf acceptance criterion use
  Normal difficulty. Implementing difficulty selection is not required in M0.

#### Deferred multiplayer follow-up

- Decide whether cooperative or other non-competitive multiplayer scenarios
  expose the same enemy scaling. Multiplayer begins only after the
  single-player campaign is complete, so this does not block Q25.

#### Resolved follow-up: Where is difficulty selected?

- The player chooses a default difficulty when starting a campaign, and the
  campaign save stores that preference.
- Before each mission, the difficulty selector starts at the campaign default
  but allows a one-mission override.
- Overriding one mission does not silently change the campaign default.
- A mission save stores the effective difficulty and concrete scaling parameters
  used when that mission began. Changing the campaign default later does not
  alter existing mission saves.

#### Resolved follow-up: Can difficulty change during a mission?

- Difficulty never rescales a battle already in progress.
- The pause menu offers **Change Difficulty and Restart**, which discards the
  current runtime state and reconstructs the mission at the newly selected
  difficulty.
- Existing manual, quick, and automatic mission saves retain the difficulty on
  which they were created and do not change when the mission is restarted at
  another setting.

#### Resolved follow-up: Does difficulty affect progression or rewards?

- Easy, Normal, and Hard all grant full campaign progress, story access, and
  gameplay unlocks.
- Difficulty does not alter mission resources, unit unlocks, or campaign
  rewards.
- The campaign save records the highest difficulty completed for each mission.
- Completing a mission on Hard also satisfies Normal and Easy completion
  records; completing it on Normal also satisfies Easy.
- Difficulty-specific achievements may use those records later without locking
  gameplay content behind a difficulty setting.
- No score multiplier is required unless a later design introduces a formal
  scoring system.

**Depends on:** Q1, Q15, Q20, campaign structure, and combat balance.

### Q26. How do repair, healing, and health recovery work?

**State:** Resolved for game-wide design; excluded from M0.

Define how damaged buildings, vehicles, biological units, and living Circle
constructs recover health. Cover who can perform repairs or healing, valid
targets, resource costs, rates, range, interruption, support-network
requirements, and whether recovery can occur during combat.

This question must also distinguish active repair or healing from passive
regeneration, and field support from recovery at a dedicated structure.
Destroyed actors are not revived unless a later design explicitly introduces a
separate reconstruction or resurrection mechanic.

#### Existing constraints from resolved decisions

- M0 has no ARC repair, healing, or passive recovery. Its unit and building
  damage persists until destruction or restart.
- A damaged building or fully deployed actor's sale refund scales directly with
  its remaining ordinary health under Q8. This calculation does not depend on
  the eventual price of repair.
- Healing a target proportionally removes unrecovered damage from Q24's
  veterancy contribution ledger. Returning to full health clears that ledger.
- The full design must account for ARC machinery and personnel as well as the
  Circle's biological and living constructed actors without assuming every
  faction uses the same presentation or provider.
- Save data must preserve health, ongoing recovery work, its payer and provider,
  and any resources already committed.

#### Draft direction: Separate unit support from building repair

- Unit recovery uses dedicated support units rather than a general-purpose
  recovery-tag system.
- ARC uses a **Medic** for human units and a **Mechanic** for mobile machine
  units and vehicles.
- The Circle uses parallel support roles. A **Healer** restores elven and other
  biological units; an **Artificer** restores mobile living constructs and
  vehicles.
- These support units restore health as their normal operation instead of
  carrying or firing ordinary weapons.
- Healing or repairing a mobile unit consumes time but no faction resources.
  The support unit's opportunity cost, positioning, and vulnerability provide
  the strategic cost.
- Destroyed units cannot be healed or repaired.
- Buildings do not require a Medic, Mechanic, Healer, Artificer, or builder to
  repair them.
- A damaged building exposes a normal contextual **Repair** action. Once
  ordered, repair proceeds automatically over time in the same general way as
  automatic building construction.
- Building repair consumes resources and time. Its cost must remain lower than
  the net cost of selling or losing that building and constructing a
  replacement.
- A destroyed building cannot be repaired; reconstruction creates a new actor.
- Save data preserves active building-repair progress and committed resources.

#### Resolved follow-up: How do support units choose and service targets?

- An idle Medic, Mechanic, Healer, or Artificer automatically services the
  nearest damaged eligible unit within a modest, data-driven acquisition
  radius.
- Selecting a support unit and context-clicking a damaged eligible unit issues
  a priority **Heal** or **Repair** order.
- The support unit paths into service range, stops, and restores health
  continuously over time.
- The target may continue moving. Recovery pauses while it is out of range, and
  the support unit follows only within a limited, data-driven pursuit distance.
- An ordinary Move or Stop order replaces the support order. Taking damage does
  not cancel it automatically.
- A support unit services one target at a time, and only one support unit may
  service a particular target at a time. Free healing or repair therefore
  cannot be multiplied by stacking providers.
- Automatic service never replaces or interrupts a manual order.

#### Resolved follow-up: What do building repair and its timing cost?

- A building repair job records the building's missing health when the order
  begins. Damage taken afterward is not added to that job; the player may issue
  another Repair order when it finishes.
- Repair attempts one deterministic tick per second. A full tick restores 1%
  of the building's maximum health, with a smaller final tick when necessary.
- A building beginning at 40% health therefore requires 60 seconds to reach
  full health if the job is not paused and the building takes no new damage.
- The total cost of repairing 100% maximum health is 50% of the building's
  original common-resource cost. A particular job costs that amount multiplied
  by the missing-health fraction recorded when it begins.
- Repair uses only the faction's common resource: ARC Materials or Circle
  Lifebloom. It never consumes rare or exotic resources.
- No cost is paid or reserved up front. Immediately before each tick, the game
  charges only the portion corresponding to the health that tick will restore.
  If that amount is unavailable, no health is restored and repair stops.
- Cancelling a repair keeps all health already restored. There is no refund
  because future ticks have not been paid for.
- Damage does not interrupt an active repair job. Destruction ends the job and
  does not refund resources spent on earlier ticks.
- The building remains operational while repairing if it is otherwise
  connected. Disconnection pauses repair without losing its recorded target or
  progress.
- Only one repair job may be active on a building at a time.
- Exact fractional-resource accounting and display are implementation details,
  but cumulative tick charges must equal the deterministic calculated job cost.

#### Resolved follow-up: What happens when a repair tick cannot be paid?

- The repair job enters **Paused — Insufficient Resources** rather than
  ending.
- Its recorded target health, remaining repair amount, and progress are
  preserved.
- The job resumes automatically as soon as the faction stockpile can pay its
  next tick and no other pause condition applies.
- The player may still cancel the paused job manually without losing health
  already restored.
- One grouped economy alert explains the pause. The game does not repeat that
  notification every second while the same job remains unaffordable.

#### Resolved follow-up: How do simultaneous repair jobs spend resources?

- Repair jobs receive payment priority in the order they were started.
- At each one-second boundary, payable repair ticks are processed oldest first.
- If the next priority job cannot afford its tick, that job and every
  lower-priority repair job pause for that second. Resources can therefore
  accumulate for an earlier expensive repair rather than being consumed by
  cheaper later work.
- The interface shows each repair job's priority and current resource drain.
- Cancelling and restarting a repair moves it to the back of the payment queue.

#### Resolved follow-up: How many infrastructure jobs can progress at once?

- Construction and building repair share one faction-wide
  **infrastructure-work** capacity pool.
- A basic faction has one active infrastructure slot. Unit healing, mobile-unit
  repair, unit production, and later research do not consume it.
- Additional blueprints and building-repair orders may still be issued and wait
  in a visible queue.
- A blueprint pays its full cost and reserves its footprint when placed even if
  queued. It retains the existing full cancellation refund until construction
  completes.
- A queued building repair pays nothing until it actively restores health.
- Jobs normally start in order. A disconnected, unaffordable, or otherwise
  blocked job yields its slot temporarily without losing progress or queue
  priority.
- When that job becomes eligible again, it does not interrupt a job already
  using a slot. It resumes when a slot next becomes available.
- Command Center upgrades may add parallel infrastructure slots. Individual
  tiers and costs are later content and balance decisions.
- M0 uses one infrastructure slot and has no building repair or upgrades. Its
  Materials Refinery and Field Barracks construction is therefore sequential.

#### Resolved follow-up: How are deployable actors repaired?

- Every deployable actor has one stable recovery policy:
  **unit-serviced** or **infrastructure-serviced**.
- Changing between mobile, transitioning, and deployed modes never changes that
  policy.
- A unit-serviced deployable, such as a vehicle with a deployed firing stance,
  is repaired for free by a Mechanic or Artificer in either stable mode.
- An infrastructure-serviced deployable, such as a mobile Command Center
  crawler, uses paid building repair and consumes an infrastructure slot.
- An infrastructure-serviced actor must be fully deployed and connected, or be
  an operational network root, for repair to progress.
- Beginning undeployment pauses its repair, yields the infrastructure slot, and
  preserves progress. After redeployment, the job may re-enter the queue.
- Oversized status alone does not determine an actor's recovery policy.

#### Resolved follow-up: What are the faction support units called?

- ARC's human support unit is the **Medic**.
- ARC's machine and vehicle support unit is the **Mechanic**.
- The Circle's biological support unit is the **Healer**.
- The Circle's mobile living-construct support unit is the **Artificer**.
- These plain role names communicate valid targets without requiring additional
  lore or interface explanation.

#### Resolved follow-up: Is recovery available passively or through structures?

- Player-controlled units and buildings have no universal passive health
  regeneration.
- The game requires no standard hospital, repair bay, or other dedicated
  recovery structure.
- Medic, Mechanic, Healer, and Artificer are the normal recovery path for mobile
  units. Paid contextual Repair is the normal path for buildings and
  infrastructure-serviced deployables.
- A particular actor, upgrade, aura, or scripted effect may explicitly grant
  regeneration later, normally after an authored out-of-combat delay. This is a
  special capability rather than a default rule.
- Regeneration exceptions update Q24's unrecovered-damage contribution ledger
  like every other form of healing.

**Depends on:** Q8, Q9, Q15, Q22, Q24, and the broader faction roster.

### Q27. How do building upgrades work?

**State:** Resolved for game-wide design; excluded from M0.

Define whether upgrades apply to one building, a building class, or the whole
faction. Cover prerequisites, branching or mutually exclusive choices, costs,
timing, cancellation, operation during an upgrade, visual changes, footprint
changes, support-network behavior, destruction, resale, and save data.

#### Existing constraints from resolved decisions

- M0 excludes research, technology trees, and upgrades.
- Upgrade definitions should be data-driven and may use common, rare, or later
  exotic resources according to their technology tier.
- An upgrade cannot bypass ordinary placement, occupancy-layer, or
  support-network rules.
- Changes to maximum health must interact coherently with damage, Q8's resale
  health fraction, Q24's damage-contribution ledger, and Q26's repair rules.
- Upgrade state and progress must be serializable and deterministic.
- Detector upgrades may increase range or contact precision, extend supported
  occupancy layers or concealment categories, or add another detection kind.
- A Command Center upgrade may add slots to the faction-wide infrastructure
  pool shared by building construction and building repair. Individual tier
  values and costs remain later content and balance decisions.

#### Resolved Q27 foundation: What owns an upgrade and how is it unlocked?

- A building upgrade is installed on a specific building actor. It is available
  through that building's context menu and sidebar actions, alongside actions
  such as Repair and Sell.
- Each building type defines a finite number of upgrade tiers. The number may
  differ by building, and some buildings have no upgrades.
- Campaign progression determines the highest tier that may be installed for
  each building type. Early campaign missions may permit no upgrades at all.
- That campaign unlock is only an availability cap. Purchased and installed
  upgrades belong to the current mission and are not carried into the next one.
  A mission script may still place a building at a specified tier.
- A newly constructed replacement begins unupgraded unless the mission script
  says otherwise. A deployable building retains its installed upgrades while
  changing between its mobile and deployed modes.
- An installed upgrade may improve the building itself or grant a
  faction-wide capability while that building remains operational. Selling or
  destroying it removes those installed effects.
- Command Center upgrades may add infrastructure queue slots and extend
  construction support. Barracks upgrades may unlock advanced units such as
  Snipers, Medics, and Mechanics. Radar upgrades may increase detection range
  and add detectable kinds. Other buildings define comparable, data-driven
  effects.
- Building upgrades are distinct from broader, permanent research and
  technology-tree progression.
- Q8's sale basis includes the building's construction cost and every
  completed, installed upgrade cost. Campaign unlocks add no resale value.
- Mission saves record each building's installed tier and any in-progress
  upgrade state. Campaign saves record the maximum tiers unlocked through
  campaign progression.

#### Resolved Q27 follow-up: How is an upgrade executed?

- The full upgrade cost is paid when the upgrade enters the faction-wide
  infrastructure queue. The player cannot queue it without enough resources.
- An active upgrade consumes one infrastructure slot. Waiting upgrades occupy
  no slot, following the shared construction-and-repair queue rules from Q26.
- A building may have at most one waiting or active upgrade of its own.
- A completed building may not have repair and upgrade work waiting or active
  at the same time. Starting either requires cancelling the other under its
  existing cancellation rules.
- The building remains operational at its last completed tier while its upgrade
  is in progress. The new tier and all of its effects apply only when the work
  finishes.
- Cancelling an unfinished upgrade returns its full cost and leaves the
  building at its last completed tier.
- Losing support-network connection pauses an upgrade and yields its
  infrastructure slot. It resumes under Q26's ordinary queue-priority rules
  after the connection returns.
- Taking damage does not interrupt an upgrade.
- A building cannot be sold or begin undeploying while an upgrade is waiting or
  active. The player must cancel the upgrade first.
- If the building is destroyed, its paid upgrade cost is lost.

#### Resolved Q27 follow-up: Are upgrade tiers linear or branching?

- Each building type has a strictly linear sequence of upgrade tiers. A tier
  requires the preceding tier on that building.
- Building upgrades have no mutually exclusive branches. Broader strategic
  choices and branching progression belong to the separate research system.

#### Resolved Q27 follow-up: Can upgrades change a building's footprint?

- An upgrade never changes the building's tile footprint, anchor, orientation,
  or collision. Its completion therefore cannot invalidate nearby placement,
  change pathfinding occupancy, or trap an actor.
- Upgrades may visibly add modules, animation, lighting, textures, or other
  tier-specific details without changing that gameplay footprint.
- The building's installed tier appears in its sidebar details and beside its
  world-space health or status display.
- A transformation that requires a larger or different footprint is a separate
  building type rather than an upgrade tier.

#### Resolved Q27 follow-up: How do upgrades interact with building health?

- An upgrade may change a building's maximum health when its data definition
  explicitly says so.
- Completing any upgrade restores the building to its full current maximum
  health, including upgrades that do not raise maximum health. This makes the
  completed work a full refit and gives upgrade timing a deliberate strategic
  benefit.
- No restoration occurs before completion. Cancelling retains the building's
  existing health, while destruction loses the building and paid upgrade cost.
- An unusual effect that lowers maximum health clamps current health to the new
  maximum.
- Completed upgrades do not change Q26's building-repair price basis. A repair
  from zero to full health continues to cost 50% of the building's base
  common-resource construction cost, even when upgrades increase its health or
  value. Upgrade spending affects resale value, not repair price.

#### Resolved Q27 follow-up: What happens when infrastructure capacity falls?

- Infrastructure capacity changes take effect immediately.
- If active work exceeds the new capacity, the oldest active jobs continue.
  Newer excess jobs pause until the number of active jobs fits the limit. A
  stable job identifier breaks equal-time ties deterministically.
- Paused jobs retain their progress, paid resources, and original queue
  priority. They resume normally when capacity becomes available again.
- Capacity loss never cancels work or creates a refund. The interface produces
  one grouped infrastructure-capacity warning rather than one alert per job.
- This rule also covers future effects that temporarily disable a building or
  other source that contributes infrastructure capacity.

**Depends on:** Q8, Q9, Q12, Q15, Q22, Q24, Q26, and technology-tree design.

### Q28. How does modding work?

**State:** Foundation resolved; remaining work deliberately deferred and
excluded from M0.

Define the intended modding surface for data, maps, campaigns, rules, scripts,
interface extensions, and assets. Cover packaging, discovery, dependencies,
version compatibility, load order, conflicts, validation, permissions,
distribution, and how saves identify required mods.

#### Existing constraints from resolved decisions

- The browser-runnable deterministic simulation core and its platform-service
  boundaries remain authoritative.
- Game balance, actors, factions, campaigns, and other content should remain
  data-driven so supported changes do not require editing engine code.
- Mod state that affects simulation must be deterministic, serializable, and
  represented in save compatibility checks.
- Unsafe or privileged script access must not bypass the browser and Tauri
  security boundaries.
- Mod support is distinct from the deferred map editor. Either may exist
  without requiring the other to ship at the same time.
- Multiplayer compatibility and synchronization remain deferred until after
  the single-player campaign and core mod model are established.

#### Resolved Q28 foundation: What may mods change?

- The initial supported surface is data-and-content modding: units, buildings,
  upgrades, factions, balance, maps, campaigns, objectives, visual assets,
  audio, and localization.
- Base-game content uses the same public schemas as mods wherever practical so
  the supported format is exercised by the game itself.
- Mods define mission behavior through deterministic, sandboxed events and
  actions. They cannot execute arbitrary JavaScript or native code or access
  platform services outside the approved mod API.
- Unrestricted interface extensions are not part of the initial surface.
  Sandboxed scripting and UI-extension capabilities may be considered later.
- This is a living compatibility contract. The team revisits the exact public
  schemas and capabilities as game data evolves without weakening the locked
  determinism, save-compatibility, browser, or security boundaries.

#### Resolved Q28 direction: Provide a single-player modding console

- Single-player games provide an in-game console for experimenting with the
  supported data, commands, and scripting capabilities. Its default physical-
  keyboard binding is the backtick key and may be rebound.
- The console is also reachable through an on-screen Advanced or Developer
  menu, so a physical keyboard is not required.
- Opening the console pauses the single-player simulation by default.
- The console provides command history, autocomplete, discoverable help, and
  clear validation and execution errors.
- The console exposes approved inspection and deterministic command APIs, not
  an unrestricted JavaScript or operating-system shell.
- Simulation-changing console actions enter through the same deterministic
  command boundary used by gameplay and scripts.
- Read-only inspection commands do not affect campaign eligibility.
- Before the first state-changing console command, the game warns the player
  that the current session will be marked modified. The marker persists in
  mission saves made from that session.
- Modified saves remain playable and saveable but cannot award official
  campaign completion, achievements, or progression unlocks. Loading a clean
  save or restarting the mission without state-changing console use restores
  eligibility.

#### Resolved Q28 follow-up: How are mods packaged?

- During development, a mod may be an ordinary directory. Distribution uses a
  ZIP-compatible archive with the `.cotuwmod` extension.
- Every mod has a manifest containing a stable namespaced identifier, display
  name, author, semantic version, license, supported game and schema ranges,
  dependencies, conflicts, and declared content roots.
- Package paths are relative and may not escape the package boundary.
- Browsers and desktop builds consume the same package format.
- The game validates a package before activation. An invalid package remains
  installed but disabled and reports actionable errors.
- Package format is independent of distribution. Local files, a future
  workshop, and third-party repositories may distribute identical bundles.

#### Deferred Q28 follow-ups

- Installation, discovery, storage, enablement profiles, and browser limits.
- Dependency resolution, deterministic load order, overrides, and conflicts.
- Save-file mod manifests, version changes, migrations, and missing mods.
- Schema evolution, compatibility promises, deprecation, and validation tools.
- Trust, signing, permissions, distribution, and exact console commands.
- Q28 should be revisited as each public game-data schema takes shape.

**Depends on:** Save formats, content schemas, campaign design, security,
platform services, and the later multiplayer architecture.

### Q29. How should NPC AI work?

**State:** Resolved for M0 wildlife behavior; current for remaining faction
strategic foundations. Shared control layers, strategic postures, mission
profiles, priorities, observation and memory, operation rules, and campaign
scripting support are resolved. Script conflicts and relationship changes
remain current; detailed faction plans, schemas, and tuning are deferred.

Define the behavior and architecture for non-player-controlled actors. Separate
local unit behavior, neutral wildlife, scripted mission actors, allied support,
and full opposing-faction strategy rather than treating them as one AI system.

Cover perception, scouting, memory, target selection, movement, formations,
combat, retreat, ability use, economy, construction, production, research,
expansion, defense, objective priorities, coordination, adaptation, and
recovery from losses.

#### Existing constraints from resolved decisions

- M0 requires the resolved wolf territory, sight-based alerts, pursuit, leash,
  investigation, return, and regeneration rules below. Q15 summarizes combat;
  Q29 defines the wildlife transitions and edge cases. M0 has no competing
  faction economy or strategic opponent.
- NPC perception must obey Q14 fog and Q23 detection rather than reading hidden
  simulation information unless a scenario explicitly declares and
  communicates an exception.
- NPC decisions must use deterministic simulation state and remain independent
  of rendering and platform APIs.
- Faction strategies, priorities, build plans, and mission behavior should be
  data-driven where practical.
- Easy, Normal, and Hard currently change enemy health and damage only. Any
  future difficulty-specific AI behavior requires an explicit Q25 revision.
- Save data must preserve authoritative AI state, including goals, memory,
  active plans, cooldowns, and deterministic random state when applicable.
- Multiplayer AI remains deferred until the single-player campaign and its AI
  model are established.

#### Resolved Q29 foundation: How is NPC control divided?

- NPC actors use the same movement, pathfinding, targeting, visibility, damage,
  and command systems as player-controlled actors.
- Each actor has a deterministic, serializable state machine for immediate
  behavior. Stable identifiers break otherwise equal choices.
- An encounter coordinator may share goals and events, such as alerting a wolf
  pack, but individual actors still execute movement and combat themselves.
- Future opposing-faction AI adds separate layers above actor behavior: a
  strategic director selects goals, group or squad controllers coordinate
  forces, and actor controllers execute their orders.
- Mission scripts influence NPCs by assigning goals or issuing ordinary
  commands through the simulation boundary. They do not replace movement,
  combat, perception, or actor-state logic.
- M0 wolves use these actor states: idle at home, alerted, pursuing, attacking,
  investigating an observed alert, returning, and regenerating.

#### Resolved Q29 foundation: How do faction strategic activities overlap?

**Decision date:** 2026-10-03. **Scope:** Game-wide.
Faction strategic AI remains outside M0 and task 0.42.

- Strategic activities run concurrently. A faction can build and scout while
  defending or attacking; its current posture changes priorities and resource
  allocations rather than enabling only one activity at a time.
- Establishment and building provide the economy, support connections,
  production capacity, and base layout needed for current goals.
- Economy maintains collection and replaces lost workers or resource access.
- Scouting discovers routes, resources, enemies, and objectives, and refreshes
  stale observations through ordinary vision and detection.
- Defence assesses known threats and allocates units to protect important
  assets, reinforce threatened locations, or intercept attackers.
- Military production maintains a desired force and replaces losses, using
  available technology and observed opposition to inform composition.
- Aggression includes probing, harassment, raids, and committed attacks. Each
  operation has an objective, assigned forces, and retreat conditions.
- Expansion and technology invest in future income, access, production,
  upgrades, or research when immediate needs allow.
- Recovery regroups surviving forces and rebuilds essential capacity after
  losses; it can reduce offensive commitment while other work continues.
- The strategic director assigns priorities, budgets, and forces. Group
  controllers execute operations; actor controllers handle local behavior.

**Remaining strategic foundation follow-ups:**

- How do simultaneous scripted actions resolve conflicts, and how do mission
  events change faction relationships?
- How are historical strategic reports shared beyond the locked allied vision
  and detection rules, and how are uncertainty and verification tuned?

Authoritative AI state must survive saving and loading. Exact faction schemas
for goals, assignments, reservations, observations, timers, and plans are
implementation specifications rather than additional gameplay choices.

#### Resolved Q29 follow-up: How do competing goals share resources and units?

**Decision date:** 2026-10-03. **Scope:** Game-wide.

- Protect essential income and immediate defence with resources and forces
  sufficient to keep the faction functioning.
- Allocate remaining resources and units through the mission behavior profile.
  Aggressive missions can favour attacks; cautious missions can favour growth.
- During crises, postpone optional raids or investments, use available
  reserves, and reassess whether active attacks should retreat.
- Explicit mandatory story goals may override normal priorities when the
  mission deliberately requires that behavior.
- Exact reserves, allocations, and crisis thresholds remain tunable.
- Resource denial is a strategy for players and faction AI. Disrupting
  gatherers, delivery buildings, or resource access reduces future production
  and replenishment and can divert forces or spending toward defence and
  recovery. Existing stockpiles and armies can still sustain an offensive.
- AI resource-denial operations must respect mission aggression permissions
  and ordinary scouting and detection. Resource target selection and its
  weighting remain later strategy and content work.

#### Resolved Q29 follow-up: How does strategic AI remember enemy information?

**Decision date:** 2026-10-03. **Scope:** Game-wide.

- Remember observed units, buildings, economic sites, and threats with their
  last-seen positions and observation ticks.
- Memory is historical information, not a source of live hidden positions,
  enemy stockpiles, production queues, or unobserved destruction.
- Treat older reports as increasingly uncertain and scout to refresh them
  before commitments that depend on their accuracy.
- Strategic operations can investigate remembered locations. Actor attacks
  still require current detection under the shared targeting rules.
- Preserve authoritative observations and planning memory in saves. Exact
  report lifetimes and confidence or verification rules remain open.

#### Resolved Q29 follow-up: When should an operation end, replan, or retreat?

**Decision date:** 2026-10-03. **Scope:** Game-wide. Applies to faction
operations, not the M0 wolf state machine.

- Each operation has an objective, assigned forces, and explicit completion,
  failure, and cancellation conditions.
- Confirmed objective completion ends the operation and releases surviving
  forces for new assignments. Loss of detection alone does not confirm success
  or reveal that a hidden target was destroyed.
- On lost contact, investigate the last-known location using ordinary movement
  and perception. If the search provides no viable objective, end or reassign
  an optional operation rather than track hidden movement.
- A blocked route triggers replanning within the mission's permissions. Bound
  retries or stalled time; if no viable route is found, end the optional
  operation and release or regroup its forces.
- Significant losses or newly observed threats trigger a viability check.
  Retreat, regroup, or seek permitted reinforcements when the objective no
  longer appears achievable with the assigned forces.
- A profile or relationship change triggers reevaluation of active operations.
  Cancel operations that are no longer permitted and give surviving forces
  valid follow-up assignments.
- Mandatory scripted goals use their authored failure and cancellation rules
  and report an infeasible objective to the mission logic. They do not silently
  become optional or retry forever without a defined recovery policy.
- Retreat conditions, retry limits, search scope, reinforcement budgets, and
  follow-up destinations remain tunable or mission-authored values.

#### Resolved Q29 follow-up: Which strategic postures guide the faction?

**Decision date:** 2026-10-03. **Scope:** Game-wide. Postures express the
director's current focus; they do not disable concurrent activities or require
a fixed progression.

- Establishing: secure basic income, support, production, and initial defence
  when essential capacity has not yet been established.
- Developing: grow income, production, technology, and map access while
  scouting and maintaining a defensive reserve.
- Pressuring: pursue known opportunities through probes, harassment, raids, or
  committed attacks while maintaining the economy and home protection.
- Defending: respond to a credible threat to important assets or mandatory
  objectives by reinforcing them and reassessing offensive commitments.
- Recovering: regroup survivors and restore essential capacity after losses
  while maintaining defence and enough scouting to assess further threats.
- Choose posture from observed conditions, mission goals, and available
  capacity. Elapsed time alone does not force a transition.
- Urgent threats can trigger defence immediately. Other changes require a
  sustained reason, and defence ends only after the threat has stayed low for
  a tunable interval, avoiding repeated switches from brief fluctuations.
- Exact condition thresholds and intervals remain content and tuning values.

#### Resolved Q29 follow-up: How does strategic behavior vary by mission?

**Decision date:** 2026-10-03. **Scope:** Game-wide.

- Each AI faction has a data-driven mission behavior profile controlling the
  permitted postures and their emphasis.
- A mission may disable pressure entirely, allowing the faction to build,
  scout, and pursue its own affairs without initiating offensive operations.
- Earlier missions use gentler behavior to support learning; later missions
  may increase pressure as their objectives and intended experience require.
- Mission behavior profiles are independent of Q25's Easy, Normal, and Hard
  health and damage scaling. Changing difficulty does not change the profile.
- A faction whose offensive pressure is disabled defends itself locally when
  attacked. Wider retaliation requires an explicit mission rule or event.

#### Resolved Q29 follow-up: Can mission events change faction behavior?

**Decision date:** 2026-10-03. **Scope:** Game-wide. General mission scripting
and faction strategic AI remain outside task 0.42.

- Mission events can change an AI faction's active behavior profile, permitted
  postures, and priorities, assign goals, and issue ordinary commands through
  the simulation boundary.
- A negotiation outcome, objective state, region entry, or mission timer can
  trigger a behavior change through deterministic mission events and actions.
- For example, a faction begins with pressure disabled and pursues its own
  affairs. Failed negotiations trigger an event that enables pressure and
  assigns an offensive goal. The AI then plans and executes that goal through
  the normal director, group, and actor layers.
- Scripts do not bypass shared movement, targeting, perception, or combat.
  Any scenario perception exception still requires the existing explicit,
  communicated declaration.
- Event timing and ordering use simulation state. Negotiation results enter
  the mission through serializable commands rather than UI-owned state.
- Saves preserve event progress, fired one-time triggers, timers, pending
  actions, and effective AI behavior. Loading resumes the same mission without
  repeating completed one-time events or restoring an outdated profile.
- The event schema and conflicting action precedence remain open. Behavior
  changes reevaluate active operations under the resolved operation rules.

#### Resolved Q29 follow-up: How much authority does a scripted goal have?

**Decision date:** 2026-10-03. **Scope:** Game-wide.

- Ordinary scripted goals express intent. The AI chooses forces, routes,
  timing, and tactics within the active profile and can respond to urgent
  threats or infeasible goals.
- A mission can explicitly mark a goal mandatory when the story requires an
  operation. Its completion, failure, and cancellation conditions define the
  obligation; actors still obey normal simulation rules.

**Remaining script follow-ups:**

- Diplomatic relationships and offensive pressure are separate decisions.
  Define whether an event also changes who is hostile or allied, rather than
  assuming that a posture change alone changes those relationships.
- Resolve conflicting simultaneous actions and missing targets
  deterministically. Exact precedence and failure policies need a further
  decision.

#### Resolved Q29 follow-up: How do complex campaign missions use code?

**Decision date:** 2026-10-03. **Scope:** Game-wide.

- Common mission behavior uses reusable, data-driven triggers and actions.
- Complex campaign missions and storyline logic may use mission-specific
  TypeScript modules maintained in the codebase. The data system does not need
  to express every unique story sequence.
- Mission modules consume deterministic simulation state and use the shared
  event, action, and command boundaries to influence the mission and its AI.
- Modules remain browser-runnable and independent of rendering, DOM, Tauri,
  and wall-clock timing. Player choices enter as serializable commands.
- Persistent story flags, timers, branches, and other mission-specific state
  are explicit, serializable simulation data. Saves preserve runtime state;
  executable code is supplied by the game build.
- This code support applies to built-in campaign modules. Q28's mod support
  continues to use sandboxed data and events without arbitrary code execution.

#### Draft Q29 follow-up: Which mission behavior settings should be tunable?

**Scope:** Game-wide candidate fields for the future profile schema. General
posture permissions, priorities, and mission tuning are resolved above; exact
fields, presets, and values remain deferred content and implementation work.

- Posture permissions and relative priorities, including a distinct setting to
  disable offensive pressure rather than merely making attacks infrequent.
- Offensive timing and commitment: an opening grace period, time between
  operations, concurrent operation limits, and the share of forces committed.
- Defensive commitment: forces reserved at home, response area, reinforcement
  priorities, and pursuit limits.
- Development and exploration: economy, production, expansion, technology,
  and scouting priorities and limits.
- Transition stability: condition thresholds and the time they must persist
  before changing posture or leaving defence.
- Retaliation and escalation: whether provocation permits only local defence
  or broader offensive operations, and which mission events change permissions.
- Gentler early profiles could use longer grace periods, fewer and smaller
  raids, stronger home reserves, and shorter pursuit. A peaceful profile can
  prohibit offensive operations entirely.

#### Deferred Q29 strategic-AI details

- Exact build orders, base layouts, force compositions, budgets, attack and
  retreat thresholds, and planning cadence need concrete rosters and missions.
- Faction personalities, allied coordination, and campaign-specific strategies
  need a later content and tuning pass using the agreed strategic foundations.
- M0 has no strategic director, base-building opponent, or AI economy. These
  foundations do not block implementation of its wildlife behavior.

#### Resolved Q29 follow-up: How do M0 wolves select and share targets?

- A wolf keeps its current target while that target remains valid, avoiding
  rapid switching between nearby actors.
- When it needs a target, it chooses the nearest personally detected,
  reachable hostile within its leash. A stable actor identifier resolves
  equal-distance ties.
- Wolves do not prioritize injured or valuable actors and do not coordinate
  focus fire.
- Wolves become aggressive on personal detection within their own sight range.
  The alpha detects farther than normal wolves; exact ranges remain tunable.
- A wolf that observes another wolf become alerted moves to investigate the
  position where that wolf stood when the alert began. This fixed snapshot
  does not follow the alerting wolf's later movement. Each wolf selects its
  own target after personal detection.
- Alert propagation uses individual sight and terrain sightlines rather than
  a global den broadcast, and provides no live knowledge of unseen enemies.
- Loss of personal detection ends pursuit of that target and starts return to
  authored home. Investigation is the response to an observed wolf alert.
- Alerts and incoming attacks never override the hard territory leash.
- The den occupies a secluded mountain enclosure with a chokepoint entrance.
  The lone wolf guards the outside approach, with layout, sightlines, and
  encounter ranges preventing its alerts from reaching the den pack.

**Decision date:** 2026-10-03. **Scope:** M0-only.

#### Resolved Q29 follow-up: How do wolf alerts avoid repeated circulation?

**Decision date:** 2026-10-03. **Scope:** M0-only.

- Each alert has a stable identity and a fixed origin position, captured where
  the originating wolf stood when the alert began.
- A wolf responds at most once to a given alert. Seeing the same alert again
  does not restart its investigation or create a new copy.
- Relaying an alert preserves its identity and original position rather than
  making the relay wolf's position a new destination.
- A fresh personal enemy sighting can originate a new alert. Relaying or
  repeatedly observing an existing alert does not count as a fresh sighting.
- Alert lifetime, selection, and encounter reset follow the resolved lifecycle
  below.

#### Resolved Q29 follow-up: How do returning wolves react to fresh threats?

**Decision date:** 2026-10-03. **Scope:** M0-only.

- Fresh personal detection of a reachable hostile inside the leash interrupts
  return or regeneration and begins engagement.
- Taking damage interrupts regeneration and raises an alert at the wounded
  wolf's own position. Damage does not reveal an unseen attacker's position.
- Without a personally detected hostile, damage alone does not divert a
  returning wolf or move one from home. Nearby wolves can respond to its alert
  under the ordinary sight and propagation rules.
- Previously handled alerts do not interrupt return or restart investigation.
- A different eligible, unhandled alert can interrupt return under the resolved
  alert lifecycle.

#### Resolved Q29 follow-up: How are alerts selected, expired, and investigated?

**Decision date:** 2026-10-03. **Scope:** M0-only.
Exact durations remain tunable.

- Personal detection of a reachable hostile takes priority over investigating
  an alert. Retain a valid current combat target under the existing rules.
- A wolf already investigating an alert keeps that assignment rather than
  repeatedly switching to other alerts. Personal enemy detection can interrupt
  investigation and start engagement.
- With no target or investigation, choose the nearest visible, unhandled,
  unexpired alert whose origin can be reached within the leash. A stable alert
  identifier breaks equal-distance ties.
- Such a new alert can interrupt return or regeneration. Previously handled
  alerts remain ineligible.
- Alerts have a tunable lifetime measured from their creation tick. Relaying
  does not extend it. Expiration prevents new responses but does not cancel an
  investigation already underway.
- At the alert origin, look for a hostile for a short tunable interval, then
  return home if nothing is personally detected. Failure to reach the origin
  uses the resolved blocked investigation policy below.
- The encounter rests when surviving wolves are home with no current targets,
  investigations, or pending eligible alerts. Regeneration follows each
  wolf's existing out-of-combat delay; dead wolves do not respawn.

#### Resolved Q29 follow-up: How do wolves handle blocked targets and routes?

**Decision date:** 2026-10-03. **Scope:** M0-only. Retry intervals and
stalled-time limits are tunable.

- A confirmed destroyed or invalid target ends that attack. Engage another
  personally detected, reachable hostile if one exists; otherwise return home.
  Unobserved destruction grants no extra knowledge.
- Temporary blockage of pursuit or investigation permits a short wait and
  replanning within the leash. If no viable route is found within the stalled
  time limit, abandon that target or investigation and start returning.
- Remember failed approaches so the same unchanged target or alert does not
  immediately restart a failed route. Target movement or relevant navigation
  changes can permit another target attempt; handled alerts remain handled.
- If home is blocked, approach the closest reachable waiting point inside the
  territory using deterministic tie-breaking. Keep the authored home as the
  return goal and retry when the blockage or navigation changes.
- A wolf waiting short of home does not regenerate there. It can respond to
  personally detected threats or eligible new alerts under the normal rules.
- Loading restores the active state, routes, failed approaches, timers, and
  alert response history so it continues exactly as uninterrupted play would.

#### Resolved Q29 follow-up: How are M0 territories and homes represented?

**Decision date:** 2026-10-03. **Scope:** M0-only.

- Each encounter has one fixed circular territory, represented by an authored
  center and a tunable hard leash radius.
- The lone wolf has its own territory. All four normal den wolves and the alpha
  share one territory centered on the den.
- Each wolf has its own authored home position inside its encounter territory
  and returns there for resting and regeneration after disengaging.
- The shared den boundary keeps pursuit consistent across the pack; separate
  home positions keep the resting wolves spread out.

#### Q29 M0 implementation contract

M0 gameplay decisions are resolved. The
[implementation contract](../DESIGN.md#m0-wolf-implementation-contract) owns
the tunable content fields, authoritative save state, and deterministic
acceptance checks. Exact balance values remain implementation and playtest
tuning rather than additional questionnaire decisions.

**Depends on:** Q5, Q8-Q15, Q23, Q25, campaign and mission design, and the
broader faction rosters.
