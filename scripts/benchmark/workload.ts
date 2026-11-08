// A scripted two-owner mission for the M1 benchmark workloads.
import { contentPack } from "../../src/content/packs.ts";
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
import { SIMULATION_TICK_SECONDS } from "../../src/simulation/clock.ts";
import { serializeMission } from "../../src/simulation/mission-file.ts";
import {
  createScenarioMap,
  createScenarioState,
  defineScenario,
} from "../../src/simulation/scenario.ts";
import {
  BENCHMARK_TIMING,
  summarizePopulation,
  summarizeTimes,
} from "./metrics.ts";
import { attachBenchmarkProbe } from "../../src/benchmark-probe.ts";
import type { BenchmarkRecord } from "../../src/benchmark-probe.ts";

import type {
  MissionCommand,
  ScheduledCommand,
} from "../../src/simulation/command.ts";
import type { ActorDefinition } from "../../src/simulation/actor.ts";
import type { TileCoord } from "../../src/simulation/grid.ts";
import type { ScenarioUnit } from "../../src/simulation/scenario.ts";

export const WORKLOADS = {
  normal: { units: 200, buildings: 40 },
  stress: { units: 400, buildings: 80 },
} as const;
export type Workload = keyof typeof WORKLOADS;

const { warmupSeconds, measureSeconds, sampleSeconds } = BENCHMARK_TIMING;
const ticksIn = (seconds: number) =>
  Math.round(seconds / SIMULATION_TICK_SECONDS);

// Allow setup time before the browser starts its warm-up and 2x measurement.
export const SCRIPT_SECONDS = 2 * (warmupSeconds + measureSeconds) + 30;
const SHUTTLE_SECONDS = 20;
const SCOUT_SECONDS = 10;
// Barracks replace combat losses, so stocks must outlast the run.
const STOCKPILE = 1e7;
/** The probe replaces losses with these, so the scene holds its scale. */
export const REINFORCEMENT = {
  definitionId: "arc-trooper",
  producerDefinitionId: "arc-field-barracks",
} as const;
const SCOUT_SHARE = 0.1;
// Each refinery serves one Harvester.
const REFINERY_SHARE = 0.5;
// Own-side waypoints keep scouts and shuttling groups out of the fight.
const LANE_X = 50;
const LANE_Z = [30, 59, 90];
const RALLY_TICK = ticksIn(15);

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

const tileKey = ({ x, z }: TileCoord) => `${x},${z}`;
const crossingCenter = (id: string): TileCoord => {
  const crossing = SKIRMISH_CROSSINGS.find((crossing) => crossing.id === id)!;
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
      ...SKIRMISH_MAP.resourceAreas.flatMap(({ tiles, lifebloomTiles }) => [
        ...tiles,
        ...lifebloomTiles,
      ]),
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

/** A tick-0 mission file. Scheduled commands are its whole script. */
export function createBenchmarkMission(workload: Workload): string {
  const { units, buildings } = WORKLOADS[workload];
  const base = createSkirmishScenario({
    factions: { west: "arc", east: "arc" },
    playerSlot: "west",
    difficulty: "normal",
  });
  const definitions = contentPack(base.content!).actors;
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
      if (isRefinery) return;
      // Rally points need explored ground, which the first fighters reveal.
      schedule(RALLY_TICK, owner, {
        kind: "set-rally-point",
        actorId,
        target: center(middle),
      });
    });
    const harvesters = refineries;
    const scouts = Math.round(tiles.units.length * SCOUT_SHARE);
    const unitIds = tiles.units.map((tile, index) => {
      let role = "trooper";
      if (index < scouts) role = "scout";
      else if (index < scouts + harvesters) role = "harvester";
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

    const troopers = unitIds.slice(scouts + harvesters);
    const fighters = troopers.filter((_, index) => index % 2 === 0);
    const shuttlers = troopers.filter((_, index) => index % 2 === 1);
    schedule(1, owner, {
      kind: "group-attack-move",
      actorIds: fighters,
      target: center(middle),
    });
    const lane = (index: number) =>
      center(place({ x: LANE_X, z: LANE_Z[index % LANE_Z.length]! }));
    for (let leg = 0; leg * SHUTTLE_SECONDS < SCRIPT_SECONDS; leg++)
      schedule(1 + ticksIn(leg * SHUTTLE_SECONDS), owner, {
        kind: "group-move",
        actorIds: shuttlers,
        target: lane(2 * (leg % 2)),
      });
    scoutIds.forEach((actorId, index) => {
      // Staggered orders spread route searches across ticks, as play does.
      const offset = ticksIn((index / scoutIds.length) * SCOUT_SECONDS);
      for (let leg = 0; leg * SCOUT_SECONDS < SCRIPT_SECONDS; leg++)
        schedule(1 + offset + ticksIn(leg * SCOUT_SECONDS), owner, {
          kind: "move",
          actorId,
          target: lane(index + leg),
        });
    });
  });

  const scenario = defineScenario({
    ...base,
    name: `Benchmark ${workload}`,
    savePolicy: undefined,
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

/** Probe options for a workload; `now` is a monotonic millisecond clock. */
export const probeOptions = (workload: Workload, now: () => number) => ({
  scale: WORKLOADS[workload],
  reinforcement: REINFORCEMENT,
  sampleTicks: ticksIn(sampleSeconds),
  now,
});

/** Times simulation ticks; `now` is a monotonic millisecond clock. */
export function measureWorkload(workload: Workload, now: () => number) {
  const simulation = createSessionSimulation(
    loadMission(createBenchmarkMission(workload)),
  );
  const probe = attachBenchmarkProbe(simulation, probeOptions(workload, now));
  try {
    for (let tick = 0; tick < ticksIn(warmupSeconds); tick++) simulation.tick();
    probe.measure();
    for (let tick = 0; tick < ticksIn(measureSeconds); tick++)
      simulation.tick();
    return summarizeRecord(workload, probe.record());
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
