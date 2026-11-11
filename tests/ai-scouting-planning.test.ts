import { expect, test } from "vitest";

import { ARC_AI_TUNING, BASE_CONTENT } from "./helpers/content";
import { createActor } from "../src/simulation/actor";
import { scouting } from "../src/simulation/ai-scouting";
import { createObservations } from "../src/simulation/observations";
import { TerrainGrid } from "../src/simulation/terrain";

import type { Actor } from "../src/simulation/actor";
import type { MissionCommand } from "../src/simulation/command";
import type { AiConcernContext, AiRejection } from "../src/simulation/director";

const terrain = new TerrainGrid({
  width: 100,
  height: 100,
  tileSize: 1,
  terrainTypeIds: ["plain"],
});
const far = terrain.tileCenter(80, 80);
const home = terrain.tileCenter(5, 5);
const definitions = new Map(BASE_CONTENT.actors.map((d) => [d.id, d]));

function fixture(faction = "arc", tickSeconds = 0.1) {
  const scout = createActor({
    id: "scout",
    owner: "owner",
    definitionId: faction === "arc" ? "arc-scout" : "circle-wayfinder",
    worldPosition: terrain.tileCenter(40, 40),
  });
  const headquarters = createActor({
    id: "home",
    owner: "owner",
    definitionId:
      faction === "arc" ? "arc-command-center-prototype" : "circle-heartgrove",
    worldPosition: home,
  });
  headquarters.tilePlacement = { origin: { x: 5, z: 5 }, quarterTurns: 0 };
  const producer = createActor({
    id: "producer",
    owner: "owner",
    definitionId:
      faction === "arc" ? "arc-field-barracks" : "circle-musterhall",
    worldPosition: home,
  });
  producer.tilePlacement = { origin: { x: 10, z: 5 }, quarterTurns: 0 };
  const memory: Record<string, unknown> = { scoutId: scout.id };
  const observations = createObservations();
  const issued: MissionCommand[] = [];
  const rejections: AiRejection[] = [];
  let fielded: Actor | undefined = scout;
  let accepts = true;
  const context = {
    tick: Math.ceil((ARC_AI_TUNING.staleReportSeconds + 10) / tickSeconds),
    tickSeconds,
    tuning: ARC_AI_TUNING,
    terrain,
    definitions,
    memory,
    rejections,
    funds: () => 100,
    releaseFunds: () => {},
    claim: () => true,
    newActorId: () => "new-scout",
    issue: (command: MissionCommand) => {
      if (!accepts) return false;
      issued.push(command);
      return true;
    },
    view: {
      faction,
      ownMobileActor: () => fielded,
      economy: () => ({ production: [] }),
      actors: () => ({
        own: [headquarters, producer, ...(fielded ? [fielded] : [])],
      }),
      offlineIds: () => new Set<string>(),
      evaluateTraining: () => ({ accepted: true }),
      knowledge: {
        sites: [{ id: "site", tile: { x: 80, z: 80 }, resource: "materials" }],
        observations,
        seesTile: () => true,
      },
    },
  } as unknown as AiConcernContext;
  return {
    scout,
    context,
    issued,
    memory,
    observations,
    rejections,
    setFielded: (actor: Actor | undefined) => {
      fielded = actor;
    },
    setAccepts: (value: boolean) => {
      accepts = value;
    },
  };
}

test("a retreat survives a planning turn with no command capacity", () => {
  const { scout, context, issued, memory, setAccepts } = fixture();
  scout.health = 30;
  setAccepts(false);
  scouting(context);
  expect(memory.goal).toMatchObject({ kind: "retreat", position: home });
  setAccepts(true);
  scouting(context);
  expect(issued).toEqual([{ kind: "move", actorId: scout.id, target: home }]);
});

test.each(["refused", "blocked"])(
  "a %s retreat stops the old route and retries after a delay",
  (failure) => {
    const { scout, context, issued, memory, rejections } = fixture();
    scout.movement = { target: far };
    scout.health = 30;
    scouting(context);
    issued.length = 0;
    if (failure === "blocked") scout.movement.blocked = true;
    else
      rejections.push({
        concern: "scouting",
        tick: context.tick,
        command: { kind: "move", actorId: scout.id, target: home },
      });
    scouting(context);
    expect(issued).toEqual([{ kind: "stop", actorId: scout.id }]);
    expect(memory.goal).toMatchObject({
      kind: "retreat",
      retryTick: expect.any(Number),
    });
    const retry = (memory.goal as { retryTick: number }).retryTick;
    delete scout.movement;
    rejections.length = 0;
    issued.length = 0;
    scouting({ ...context, tick: retry - 1 });
    expect(issued).toEqual([]);
    scouting({ ...context, tick: retry });
    expect(issued).toEqual([{ kind: "move", actorId: scout.id, target: home }]);
  },
);

test("a refused scouting order skips its goal even while an old route runs", () => {
  const { scout, context, issued, memory, rejections } = fixture();
  scouting(context);
  scout.movement = { target: home };
  rejections.push({
    concern: "scouting",
    tick: context.tick,
    command: issued[0]!,
  });
  issued.length = 0;
  scouting(context);
  expect(memory.goal).toBeUndefined();
  expect(memory.avoid).toContainEqual({ ...far, tick: context.tick });
  expect(issued).toEqual([{ kind: "stop", actorId: scout.id }]);
});

test("refused training retries without a scout-loss delay", () => {
  const { context, issued, memory, rejections, setFielded } = fixture();
  setFielded(undefined);
  delete memory.scoutId;
  scouting(context);
  expect(issued[0]).toMatchObject({
    kind: "train-unit",
    definitionId: "arc-scout",
  });
  rejections.push({
    concern: "scouting",
    tick: context.tick,
    command: issued[0]!,
  });
  issued.length = 0;
  scouting(context);
  expect(memory.replaceTick).toBeUndefined();
  expect(issued[0]).toMatchObject({
    kind: "train-unit",
    definitionId: "arc-scout",
  });
});

test.each(["arc", "circle"])(
  "%s trains its roster's scout through the shared concern",
  (faction) => {
    const { context, issued, memory, setFielded } = fixture(faction);
    setFielded(undefined);
    delete memory.scoutId;
    scouting(context);
    expect(issued[0]).toMatchObject({
      kind: "train-unit",
      definitionId: faction === "arc" ? "arc-scout" : "circle-wayfinder",
      producerId: "producer",
    });
  },
);

test.each([0.1, 0.5])(
  "stale reports use simulation seconds at %s seconds per tick",
  (tickSeconds) => {
    const { context, memory, observations } = fixture("arc", tickSeconds);
    observations.sites.push({
      siteId: "site",
      amount: 100,
      tick: context.tick,
    });
    const staleTick =
      context.tick + Math.ceil(ARC_AI_TUNING.staleReportSeconds / tickSeconds);
    scouting({ ...context, tick: staleTick - 1 });
    expect(memory.goal).toBeUndefined();
    scouting({ ...context, tick: staleTick });
    expect(memory.goal).toMatchObject({ kind: "site", id: "site" });
  },
);

test("lost contact investigates the building's last sighting until refreshed", () => {
  const { context, scout, issued, memory, observations } = fixture();
  observations.sites.push({ siteId: "site", amount: 0, tick: context.tick });
  observations.actors.push({
    actorId: "enemy-building",
    definitionId: "arc-field-barracks",
    owner: "enemy",
    worldPosition: far,
    tilePlacement: { origin: { x: 80, z: 80 }, quarterTurns: 0 },
    tick: 0,
  });
  scouting(context);
  expect(memory.goal).toMatchObject({
    kind: "building",
    id: "enemy-building",
    position: far,
  });
  expect(issued).toEqual([{ kind: "move", actorId: scout.id, target: far }]);
  scout.movement = { target: far };
  issued.length = 0;
  scouting(context);
  expect(issued).toEqual([]);
  // Seeing the location empty removes the sighting, ending investigation.
  observations.actors.length = 0;
  scouting(context);
  expect(memory.goal).toBeUndefined();
  expect(issued).toEqual([{ kind: "stop", actorId: scout.id }]);
});

test("a site and a building with the same ID remain distinct goals", () => {
  const { context, scout, issued, memory, observations } = fixture();
  const buildingAt = terrain.tileCenter(90, 90);
  observations.actors.push({
    actorId: "site",
    definitionId: "arc-field-barracks",
    owner: "enemy",
    worldPosition: buildingAt,
    tilePlacement: { origin: { x: 90, z: 90 }, quarterTurns: 0 },
    tick: 0,
  });
  scouting(context);
  expect(memory.goal).toMatchObject({ kind: "site", id: "site" });
  scout.movement = { target: far };
  observations.sites.push({ siteId: "site", amount: 0, tick: context.tick });
  issued.length = 0;
  scouting(context);
  expect(memory.goal).toMatchObject({ kind: "building", id: "site" });
  expect(issued).toEqual([
    { kind: "move", actorId: scout.id, target: buildingAt },
  ]);
});

test("avoided stale reports leave the scout free to sweep unseen areas", () => {
  const { context, memory, issued } = fixture();
  context.view.knowledge.seesTile = () => false;
  memory.avoid = [{ ...far, tick: context.tick }];
  scouting(context);
  expect(memory.goal).toMatchObject({ kind: "area" });
  expect(issued[0]).toMatchObject({ kind: "move", actorId: "scout" });
});

test("stale reports take priority over never-seen sweep points", () => {
  const { context, memory, observations } = fixture();
  context.view.knowledge.seesTile = () => false;
  observations.sites.push({ siteId: "site", amount: 0, tick: 1 });
  scouting(context);
  expect(memory.goal).toMatchObject({ kind: "site", id: "site" });
});

test("odd sweep spacing visits whole tiles and remembers their visibility", () => {
  const { context, memory } = fixture();
  context.view.knowledge.seesTile = ({ x, z }) => {
    expect(Number.isInteger(x) && Number.isInteger(z)).toBe(true);
    return true;
  };
  scouting({
    ...context,
    tuning: {
      ...context.tuning,
      scouting: { ...context.tuning.scouting, sweepTiles: 7 },
    },
  });
  expect(memory.swept).toHaveProperty("3,3", context.tick);
});
