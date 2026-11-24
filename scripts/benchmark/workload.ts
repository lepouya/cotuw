// A scripted two-owner mission for the M1 benchmark workloads.
import { contentPack, currentContentPack } from "../../src/content/packs.ts";
import {
  createSkirmishScenario,
  SKIRMISH_OPENINGS,
} from "../../src/content/skirmish.ts";
import {
  SKIRMISH_CROSSINGS,
  SKIRMISH_MAP,
} from "../../src/content/skirmish-map.ts";
import {
  createSessionSimulation,
  loadMission,
} from "../../src/mission-loading.ts";
import {
  secondsToTicks,
  SIMULATION_TICK_SECONDS,
} from "../../src/simulation/clock.ts";
import { tileKey } from "../../src/simulation/grid.ts";
import { serializeMission } from "../../src/simulation/mission-file.ts";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../../src/simulation/scenario.ts";
import {
  attachBenchmarkProbe,
  BENCHMARK_AI_CONCERNS,
  BENCHMARK_SCENARIO_ID,
} from "../../src/benchmark-probe.ts";
import { activityTracker, matchAudit } from "../ai-match/observers.ts";
import {
  BENCHMARK_TIMING,
  summarizePopulation,
  summarizeTimes,
} from "./metrics.ts";

import type {
  BenchmarkRecord,
  BenchmarkScale,
} from "../../src/benchmark-probe.ts";
import type { FrameMeasurement } from "../../src/benchmark-frames.ts";
import type {
  MissionCommand,
  ScheduledCommand,
} from "../../src/simulation/command.ts";
import type { ActorDefinition } from "../../src/simulation/actor.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";
import type { ScenarioUnit } from "../../src/simulation/scenario.ts";
import type { MissionSimulation } from "../../src/simulation/mission.ts";

export const WORKLOADS = {
  normal: { units: 200, buildings: 40 },
  stress: { units: 400, buildings: 80 },
} as const;
export type Workload = keyof typeof WORKLOADS;
/**
 * Fielded units a held scene keeps, as shares of its target. Units already in
 * training finish after a lull in combat, so the scene can run over.
 */
export const HELD_UNITS = { min: 0.85, max: 1.1 } as const;

const { warmupSeconds, measureSeconds, sampleSeconds } = BENCHMARK_TIMING;
const ticksIn = (seconds: number) =>
  Math.round(seconds / SIMULATION_TICK_SECONDS);

const holdsPopulation = (
  {
    unitsMin,
    unitsMax,
    buildingsMin,
    buildingsMax,
  }: ReturnType<typeof summarizePopulation>,
  { units, buildings }: BenchmarkScale,
) =>
  unitsMin >= units * HELD_UNITS.min &&
  unitsMax <= units * HELD_UNITS.max &&
  buildingsMin === buildings &&
  buildingsMax === buildings;

// Allow setup time before the browser starts its warm-up and 2x measurement.
export const SCRIPT_SECONDS = 2 * (warmupSeconds + measureSeconds) + 30;
const SHUTTLE_SECONDS = 20;
const SCOUT_SECONDS = 10;
// Barracks replace combat losses, so stocks must outlast the run.
const STOCKPILE = 1e7;
/** The probe replaces losses with these, so the scene holds its scale. */
const REINFORCEMENT = {
  definitionId: "arc-trooper",
  producerDefinitionId: "arc-field-barracks",
} as const;
const SCOUT_SHARE = 0.1;
// Support units add service load and keep most shuttlers out of the fight.
const SUPPORT_SHARE = 0.3;
// A small front keeps combat active without emptying most of the scene.
const FIGHTER_SHARE = 0.1;
// Each refinery serves one Harvester.
const REFINERY_SHARE = 0.5;
// Own-side waypoints keep scouts and shuttling groups out of the fight.
const LANE_X = 50;
const LANE_Z = [30, 59, 90];
const RALLY_TICK = ticksIn(15);

/** Both owners use the standard ARC skirmish profile when the AI plays. */
const AI_PROFILE_ID = "arc-skirmish";
/** Play past the opening grace by this much before measuring the AI. */
const AI_ENGAGED_SECONDS = 60;

/** When the AI scene's measured play starts: a minute past the grace. */
const engagedSeconds = () =>
  currentContentPack("base").aiProfiles!.find(({ id }) => id === AI_PROFILE_ID)!
    .tuning.offense.graceSeconds + AI_ENGAGED_SECONDS;

/** Simulation seconds the scene's scripted orders cover from tick 0. */
export const scriptedSeconds = ({ ai = false }: BenchmarkOptions = {}) =>
  (ai ? engagedSeconds() : 0) + SCRIPT_SECONDS;

export type BenchmarkOptions = {
  /** Both owners' AI runs alongside the scripted load. */
  ai?: boolean;
};

const LAST = SKIRMISH_MAP.terrain.width - 1;
const rotate = ({ x, z }: TileCoord): TileCoord => ({
  x: LAST - x,
  z: LAST - z,
});

type Size = { width: number; depth: number };
const footprintSize = ({ footprint }: ActorDefinition): Size => ({
  width: Math.max(...footprint!.occupiedTiles.map(({ x }) => x)) + 1,
  depth: Math.max(...footprint!.occupiedTiles.map(({ z }) => z)) + 1,
});
/** Tiles a footprint covers, grown by `margin` on every side. */
const footprintTiles = (
  { x, z }: TileCoord,
  { width, depth }: Size,
  margin = 0,
) => {
  const tiles: TileCoord[] = [];
  for (let tileX = x - margin; tileX < x + width + margin; tileX++)
    for (let tileZ = z - margin; tileZ < z + depth + margin; tileZ++)
      tiles.push({ x: tileX, z: tileZ });
  return tiles;
};

const crossingCenter = (id: string): TileCoord => {
  const crossing = SKIRMISH_CROSSINGS.find((each) => each.id === id)!;
  return { x: LAST >> 1, z: (crossing.minZ + crossing.maxZ) >> 1 };
};

/** West-side tiles; east uses their rotation so both owners match. */
function layout(
  perOwnerBuildings: number,
  perOwnerUnits: number,
  headquarters: ActorDefinition,
  building: Size,
  buildingRadius: number,
) {
  const [{ baseArea, headquartersOrigins }] = SKIRMISH_MAP.starts;
  const hq = headquartersOrigins.arc;
  const reserved = new Set(
    [
      ...SKIRMISH_MAP.resourceAreas.flatMap(
        ({ materialsTiles, lifebloomTiles }) => [
          ...materialsTiles,
          ...lifebloomTiles,
        ],
      ),
      ...footprintTiles(hq, footprintSize(headquarters), 1),
    ].map(tileKey),
  );
  // Each building keeps a one-tile lane around it.
  const clear = (origin: TileCoord) =>
    footprintTiles(origin, building, 1).every(
      (tile) => !reserved.has(tileKey(tile)),
    );
  const candidates: TileCoord[] = [];
  for (
    let x = baseArea.minX;
    x + building.width - 1 <= 54;
    x += building.width + 2
  )
    for (let z = 36; z + building.depth - 1 <= 83; z += building.depth + 2)
      if (clear({ x, z })) candidates.push({ x, z });
  const homeDistance = ({ x, z }: TileCoord) => Math.hypot(x - hq.x, z - hq.z);
  candidates.sort(
    (a, b) => homeDistance(a) - homeDistance(b) || a.x - b.x || a.z - b.z,
  );

  // Grow outward so each building stays linked to headquarters support.
  const placed: TileCoord[] = [];
  const linked = (tile: TileCoord) =>
    homeDistance(tile) <= headquarters.support!.radius ||
    placed.some(
      ({ x, z }) => Math.hypot(tile.x - x, tile.z - z) <= buildingRadius,
    );
  while (placed.length < perOwnerBuildings - 1) {
    const next = candidates.findIndex(linked);
    if (next < 0)
      throw new RangeError("The benchmark map has too little building space.");
    placed.push(...candidates.splice(next, 1));
  }

  const taken = new Set(
    placed.flatMap((origin) =>
      footprintTiles(origin, building, 1).map(tileKey),
    ),
  );
  const units: TileCoord[] = [];
  for (let x = 54; x >= baseArea.minX; x -= 1)
    for (let z = 36; z <= 83; z += 1) {
      const tile = { x, z };
      if (
        (x + z) % 2 === 0 &&
        !taken.has(tileKey(tile)) &&
        !reserved.has(tileKey(tile))
      )
        units.push(tile);
    }
  if (units.length < perOwnerUnits)
    throw new RangeError("The benchmark map has too little unit space.");
  return { buildings: placed, units: units.slice(0, perOwnerUnits) };
}

/** A tick-0 mission file with scripted load and optional AI controllers. */
export function createBenchmarkMission(
  workload: Workload,
  { ai = false }: BenchmarkOptions = {},
): string {
  const { units, buildings } = WORKLOADS[workload];
  const base = createSkirmishScenario({
    factions: { west: "arc", east: "arc" },
    playerSlot: "west",
    difficulty: "normal",
  });
  const content = contentPack(base.content!);
  const definitions = content.actors;
  const scriptSeconds = scriptedSeconds({ ai });
  const definition = (id: string) =>
    definitions.find((each) => each.id === id)!;
  const refinery = definition("arc-materials-refinery");
  const barracks = definition("arc-field-barracks");
  const building = footprintSize(refinery);
  const { width, depth } = footprintSize(barracks);
  // Both share one grid of building slots.
  if (width !== building.width || depth !== building.depth)
    throw new RangeError("Benchmark buildings need matching footprints.");
  const tiles = layout(
    buildings / 2,
    units / 2,
    definition(SKIRMISH_OPENINGS.arc.headquarters),
    building,
    Math.min(refinery.support!.radius, barracks.support!.radius),
  );
  /** Rotates an origin so the footprint covers the mirrored tiles. */
  const rotateOrigin = ({ x, z }: TileCoord) =>
    rotate({ x: x + building.width - 1, z: z + building.depth - 1 });
  const map = createScenarioMap(base);
  const center = ({ x, z }: TileCoord) => map.tileCenter(x, z);
  const commands: ScheduledCommand[] = [];
  const schedule = (tick: number, owner: string, command: MissionCommand) =>
    commands.push({ tick, issuer: { owner }, command });

  const authoredBuildings = [...base.buildings];
  const authoredUnits: ScenarioUnit[] = [];
  const middle = crossingCenter("center");
  const refineries = Math.round((buildings / 2 - 1) * REFINERY_SHARE);
  SKIRMISH_MAP.starts.forEach(({ id: owner }, slot) => {
    const place = slot === 0 ? (tile: TileCoord) => tile : rotate;
    const placeOrigin = slot === 0 ? (tile: TileCoord) => tile : rotateOrigin;
    tiles.buildings.forEach((origin, index) => {
      const actorId = `${owner}-building-${index}`;
      const isRefinery = index < refineries;
      authoredBuildings.push({
        actorId,
        definitionId: isRefinery ? refinery.id : barracks.id,
        origin: placeOrigin(origin),
        owner,
      });
      if (isRefinery || index !== refineries) return;
      // Rally points need explored ground, which the first fighters reveal.
      schedule(RALLY_TICK, owner, {
        kind: "set-rally-point",
        actorId,
        target: center(middle),
      });
    });
    const harvesters = refineries;
    const scouts = Math.round(tiles.units.length * SCOUT_SHARE);
    const supportStart =
      tiles.units.length - Math.round(tiles.units.length * SUPPORT_SHARE);
    const unitIds = tiles.units.map((tile, index) => {
      let role = "trooper";
      if (index < scouts) role = "scout";
      else if (index < scouts + harvesters) role = "harvester";
      else if (index >= supportStart)
        role = index % 2 === 0 ? "medic" : "mechanic";
      const actorId = `${owner}-${role}-${index}`;
      authoredUnits.push({
        actorId,
        definitionId: `arc-${role}`,
        owner,
        tile: place(tile),
      });
      return actorId;
    });

    const scoutIds = unitIds.slice(0, scouts);
    const homeSites = base
      .sites!.filter(({ id }) =>
        base.skirmish!.startingResourceSites[owner]!.includes(id),
      )
      .map(({ id }) => id);
    unitIds.slice(scouts, scouts + harvesters).forEach((actorId, index) => {
      schedule(1, owner, {
        kind: "assign-refinery",
        actorId,
        refineryId: `${owner}-building-${index}`,
      });
      schedule(1, owner, {
        kind: "gather",
        actorId,
        siteId: homeSites[index % homeSites.length]!,
      });
    });

    const troopers = unitIds.slice(scouts + harvesters, supportStart);
    const fighters = troopers.slice(
      0,
      Math.max(1, Math.round(troopers.length * FIGHTER_SHARE)),
    );
    const shuttlers = unitIds.slice(scouts + harvesters + fighters.length);
    schedule(1, owner, {
      kind: "group-attack-move",
      actorIds: fighters,
      target: center(middle),
    });
    const lane = (index: number) =>
      center(place({ x: LANE_X, z: LANE_Z[index % LANE_Z.length]! }));
    for (let leg = 0; leg * SHUTTLE_SECONDS < scriptSeconds; leg++)
      schedule(1 + ticksIn(leg * SHUTTLE_SECONDS), owner, {
        kind: "group-move",
        actorIds: shuttlers,
        target: lane(2 * (leg % 2)),
      });
    scoutIds.forEach((actorId, index) => {
      // The director owns one scout's routes in the AI workload.
      if (ai && index === 0) return;
      // Staggered orders spread route searches across ticks, as play does.
      const offset = ticksIn((index / scoutIds.length) * SCOUT_SECONDS);
      for (let leg = 0; leg * SCOUT_SECONDS < scriptSeconds; leg++)
        schedule(1 + offset + ticksIn(leg * SCOUT_SECONDS), owner, {
          kind: "move",
          actorId,
          target: lane(index + leg),
        });
    });
  });

  const scenario = defineScenario({
    ...base,
    id: BENCHMARK_SCENARIO_ID,
    name: `Benchmark ${workload}`,
    savePolicy: undefined,
    ...(ai && {
      ai: SKIRMISH_MAP.starts.map(({ id }) => ({
        owner: id,
        profileId: AI_PROFILE_ID,
      })),
    }),
    buildings: authoredBuildings,
    units: authoredUnits,
    stockpiles: base.stockpiles!.map((stockpile) => ({
      ...stockpile,
      amount: STOCKPILE,
    })),
    sites: base.sites!,
    loot: base.loot!,
  });
  const state = createScenarioState(scenario, definitions);
  state.commands = commands.sort((a, b) => a.tick - b.tick);
  return serializeMission(scenario, state, SIMULATION_TICK_SECONDS);
}

/** Serializable probe options; each caller supplies its own clock. */
export const probeOptions = (workload: Workload) => ({
  scale: WORKLOADS[workload],
  maxUnits: Math.floor(WORKLOADS[workload].units * HELD_UNITS.max),
  reinforcement: {
    ...REINFORCEMENT,
    trainingTicks: secondsToTicks(
      currentContentPack("base").actors.find(
        ({ id }) => id === REINFORCEMENT.definitionId,
      )!.trainingSeconds,
      SIMULATION_TICK_SECONDS,
    ),
  },
  sampleTicks: ticksIn(sampleSeconds),
});

/** Ticks a scene while the probe holds its scale. */
function playHeld(
  simulation: MissionSimulation,
  workload: Workload,
  ticks: number,
) {
  const probe = attachBenchmarkProbe(simulation, {
    ...probeOptions(workload),
    now: () => 0,
  });
  try {
    for (let tick = 0; tick < ticks; tick++) simulation.tick();
  } finally {
    probe.detach();
  }
}

/**
 * The AI scene saved a minute past its opening grace with its load running.
 * Loading it by hand runs the full AI, which keeps training.
 */
export function createEngagedAiMission(workload: Workload): string {
  const mission = loadMission(createBenchmarkMission(workload, { ai: true }));
  const simulation = createSessionSimulation(
    mission,
    undefined,
    BENCHMARK_AI_CONCERNS,
  );
  try {
    playHeld(simulation, workload, ticksIn(engagedSeconds()));
    return serializeMission(
      mission.scenario,
      simulation.snapshot(),
      simulation.tickSeconds,
    );
  } finally {
    simulation.dispose();
  }
}

export function measureWorkload(
  workload: Workload,
  { ai = false }: BenchmarkOptions = {},
) {
  const simulation = createSessionSimulation(
    loadMission(
      ai ? createEngagedAiMission(workload) : createBenchmarkMission(workload),
    ),
    undefined,
    ai ? BENCHMARK_AI_CONCERNS : undefined,
  );
  const probe = attachBenchmarkProbe(simulation, {
    ...probeOptions(workload),
    now: () => performance.now(),
  });
  const activity = activityTracker();
  const audit = matchAudit(simulation);
  const tick = () => {
    const outcomes = simulation.tick();
    // The director planned this tick from its starting state.
    const planned = simulation.completedTicks - 1;
    activity.observe(simulation.ai, planned, outcomes);
    audit.observe(planned);
  };
  try {
    for (let count = 0; count < ticksIn(warmupSeconds); count++) tick();
    probe.measure();
    for (let count = 0; count < ticksIn(measureSeconds); count++) tick();
    const record = probe.record();
    if (ai && !record.attacks)
      throw new Error("The AI benchmark must include combat while measuring.");
    const summary = summarizeRecord(workload, record);
    if (ai && !holdsPopulation(summary.population, WORKLOADS[workload]))
      throw new Error("The AI benchmark did not hold its measured scale.");
    return {
      ...summary,
      ...(ai && {
        ai: {
          owners: Object.fromEntries(
            Object.keys(simulation.ai).map((owner) => [
              owner,
              activity.report(owner),
            ]),
          ),
          audit: audit.problems(),
        },
      }),
    };
  } finally {
    probe.detach();
    simulation.dispose();
  }
}

export function summarizeRecord(workload: Workload, record: BenchmarkRecord) {
  return {
    workload,
    targetPopulation: WORKLOADS[workload],
    ticks: summarizeTimes(record.ticks),
    rejections: record.rejected.length,
    rejected: [...new Set(record.rejected)],
    population: summarizePopulation(record.population),
    activity: {
      attacks: record.attacks,
      gatheredMaterials: record.gatheredMaterials,
      deliveredMaterials: record.deliveredMaterials,
    },
  };
}

/** One rendered run's report; `runtime` names the browser or packaged app. */
export function frameResult(
  runtime: string,
  workload: Workload,
  speed: number,
  measured: FrameMeasurement,
) {
  const seconds = measured.elapsed / 1_000;
  return {
    runtime,
    speed,
    renderer: measured.renderer,
    buffer: measured.buffer,
    elapsedSeconds: seconds,
    fps: measured.frames.length / seconds,
    frames: summarizeTimes(measured.frames),
    framesWithin20ms:
      measured.frames.filter((time) => time <= 20).length /
      measured.frames.length,
    ...summarizeRecord(workload, measured.record),
    scriptExhausted: measured.simulationSeconds > scriptedSeconds({ ai: true }),
    ticksPerSecond: measured.record.ticks.length / seconds,
    tickShortfall:
      (seconds * speed) / SIMULATION_TICK_SECONDS -
      measured.record.ticks.length,
  };
}

/** Why a rendered run cannot stand as a measurement; empty when it can. */
export function frameResultProblems(result: ReturnType<typeof frameResult>) {
  return [
    result.buffer !== "1920x1080" && `rendered ${result.buffer}`,
    result.scriptExhausted && "outlasted its load script",
    result.elapsedSeconds < measureSeconds &&
      "ended before the full measurement window",
    !holdsPopulation(result.population, result.targetPopulation) &&
      "did not hold the target population",
    result.activity.attacks === 0 && "had no combat",
    result.activity.gatheredMaterials === 0 && "gathered nothing",
    result.rejected.some((kind) => kind !== "move") &&
      `rejected ${result.rejected.join(", ")}`,
  ].filter((problem) => problem !== false);
}
