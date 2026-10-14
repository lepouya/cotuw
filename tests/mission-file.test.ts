import { describe, expect, test } from "vitest";

import { LEVEL_SOURCES } from "../src/content/levels";
import { SIMULATION_TICK_SECONDS } from "../src/simulation/clock";
import { createSessionSimulation, loadMission } from "../src/session";
import { createMissionState } from "../src/simulation/mission";
import {
  MISSION_FILE_VERSION,
  parseMission,
  serializeMission,
} from "../src/simulation/mission-file";
import { createScenarioMap } from "../src/simulation/scenario";
import { TerrainGrid } from "../src/simulation/terrain";
import { buildLevels } from "../scripts/levels";

import type { MissionScenario } from "../src/simulation/mission-file";

const scenario: MissionScenario = {
  id: "test",
  content: { id: "base", version: 1 },
  tileSize: 1,
  terrainTypeIds: ["plain", "water"],
};

function testMission() {
  const map = new TerrainGrid({
    width: 3,
    height: 2,
    tileSize: 1,
    terrainTypeIds: scenario.terrainTypeIds,
    createHeight: (x, z) => x * 0.1 + z,
    createTerrain: (x, z) => ({
      typeId: x === 2 && z === 1 ? "water" : "plain",
      outOfBounds: x === 0 || undefined,
    }),
  });
  return {
    ...createMissionState([]),
    scenarioId: "test",
    terrain: map.terrainState(),
    fog: { explored: "100011" },
  };
}

describe("mission files", () => {
  test("round-trip state and draw terrain from north to south", () => {
    const state = testMission();
    const source = serializeMission(scenario, state, 1, {
      name: "Before the den",
      savedAt: "2026-10-04T12:00:00.000Z",
    });
    const file = JSON.parse(source);
    expect(file.state.terrain.tiles).toEqual(["#.~", "#.."]);
    expect(file.state.terrain.legend).toEqual({
      "#": { typeId: "plain", outOfBounds: true },
      ".": { typeId: "plain" },
      "~": { typeId: "water" },
    });
    expect(file.state.terrain.heights).toEqual([
      [2, 2.1, 2.2, 2.3],
      [1, 1.1, 1.2, 1.3],
      [0, 0.1, 0.2, 0.3],
    ]);
    expect(file.state.fog.explored).toEqual(["011", "100"]);
    const parsed = parseMission(source, 1);
    expect(parsed.state).toEqual(state);
    expect(parsed.scenario).toEqual(scenario);
    expect(parsed.save?.name).toBe("Before the den");
  });

  test("accept hand edits and explain malformed terrain", () => {
    const file = JSON.parse(serializeMission(scenario, testMission(), 1));
    file.state.terrain.tiles[1] = "#~.";
    const edited = parseMission(JSON.stringify(file), 1).state.terrain;
    expect(edited.tiles[1]).toEqual({ typeId: "water" });
    file.state.terrain.tiles[1] = "#?.";
    expect(() => parseMission(JSON.stringify(file), 1)).toThrow(
      'Terrain tile (1, 0) uses "?"',
    );
    file.state.terrain.tiles[1] = "#.";
    expect(() => parseMission(JSON.stringify(file), 1)).toThrow(
      "2 tile rows of 3 characters",
    );
    file.state.terrain.tiles[1] = "#..";
    file.state.terrain.heights.pop();
    expect(() => parseMission(JSON.stringify(file), 1)).toThrow(
      "3 height rows of 4 numbers",
    );
  });

  test("reject other formats, versions, tick rates, and mismatched state", () => {
    const source = serializeMission(scenario, testMission(), 1);
    expect(() => parseMission("{", 1)).toThrow("not valid JSON");
    expect(() => parseMission('{"version": 8}', 1)).toThrow(
      "not a mission file",
    );
    expect(() =>
      parseMission(source.replace(/"version": \d+/, '"version": 2'), 1),
    ).toThrow(`version 2; this build reads version ${MISSION_FILE_VERSION}`);
    expect(() => parseMission(source, 0.5)).toThrow("this build runs at 2");
    const file = JSON.parse(source);
    file.state.scenarioId = "other";
    expect(() => parseMission(JSON.stringify(file), 1)).toThrow("scenarioId");
  });

  test("explain malformed hand edits of a level", () => {
    const edited = (edit: (file: any) => void) => {
      const file = JSON.parse(LEVEL_SOURCES.get("arc-economy-opening")!);
      edit(file);
      return () => loadMission(JSON.stringify(file));
    };
    expect(
      edited((file) => {
        file.state.terrain.legend["~"].typeId = "lava";
      }),
    ).toThrow('Terrain legend "~" needs a typeId listed in terrainTypeIds.');
    expect(
      edited((file) => {
        file.state.terrain.heights[0][0] = "high";
      }),
    ).toThrow("101 height rows of 101 numbers");
    expect(
      edited((file) => {
        delete file.state.terrain.navigationVersion;
      }),
    ).toThrow("navigationVersion");
    expect(
      edited((file) => {
        delete file.state.actors;
      }),
    ).toThrow("actors list");
    expect(
      edited((file) => {
        file.state.actors.push(null);
      }),
    ).toThrow("actors list");
  });

  test("the bundled levels match their generator", () => {
    const generated = buildLevels();
    expect([...generated.keys()].sort()).toEqual(
      [...LEVEL_SOURCES.keys()].sort(),
    );
    for (const [id, source] of generated)
      expect(LEVEL_SOURCES.get(id), "Regenerate with `npm run levels`.").toBe(
        `${source}\n`,
      );
  });

  test("bundled and generated levels load into the simulation", () => {
    for (const source of [...LEVEL_SOURCES.values(), ...buildLevels().values()])
      expect(loadMission(source).state.tick).toBe(0);
    const file = JSON.parse(LEVEL_SOURCES.get("sandbox")!);
    file.scenario.content.version = 0;
    expect(() => loadMission(JSON.stringify(file))).toThrow(
      "content pack base version 0; this build has version 1",
    );
    file.scenario.content = { id: "missing", version: 1 };
    expect(() => loadMission(JSON.stringify(file))).toThrow(
      'no content pack named "missing"',
    );
    file.scenario.content = { id: "base", version: 1 };
    file.scenario.actors = ["arc-trooper", "dragon"];
    expect(() => loadMission(JSON.stringify(file))).toThrow(
      'has no actor named "dragon"',
    );
  });

  test("bundled levels load at the build's tick rate", () => {
    for (const [id, source] of LEVEL_SOURCES)
      expect(parseMission(source, SIMULATION_TICK_SECONDS).scenario.id).toBe(
        id,
      );
  });
});

test.each([
  [
    "string tile size",
    (file: any) => {
      file.scenario.tileSize = "1";
    },
    "tile size",
  ],
  [
    "empty ID",
    (file: any) => {
      file.scenario.id = file.state.scenarioId = "";
    },
    "scenario ID",
  ],
  [
    "duplicate terrain types",
    (file: any) => {
      file.scenario.terrainTypeIds.push("plain");
    },
    "terrain types",
  ],
  [
    "invalid terrain ID",
    (file: any) => {
      file.scenario.terrainTypeIds.push(null);
    },
    "terrain types",
  ],
  [
    "invalid actors",
    (file: any) => {
      file.scenario.actors = {};
    },
    "distinct actor IDs",
  ],
  [
    "duplicate actors",
    (file: any) => {
      file.scenario.actors = ["wolf", "wolf"];
    },
    "distinct actor IDs",
  ],
  [
    "invalid content reference",
    (file: any) => {
      file.scenario.content = "base";
    },
    "content pack ID",
  ],
  [
    "invalid briefing",
    (file: any) => {
      file.scenario.briefing = {};
    },
    "briefing",
  ],
  [
    "invalid goals",
    (file: any) => {
      file.scenario.goals = [null];
    },
    "goals",
  ],
  [
    "unknown goal actor",
    (file: any) => {
      file.scenario.goals = [{ definitionId: "dragon", label: "Train" }];
    },
    "unknown actor",
  ],
  [
    "invalid objectives",
    (file: any) => {
      file.scenario.objectives = {};
    },
    "objectives",
  ],
  [
    "duplicate popups",
    (file: any) => {
      const popup = {
        id: "intro",
        title: "Intro",
        text: "Text",
        trigger: { kind: "actor", definitionId: "arc-trooper" },
      };
      file.scenario.popups = [popup, popup];
    },
    "popups need distinct IDs",
  ],
  [
    "invalid popup trigger",
    (file: any) => {
      file.scenario.popups = [
        {
          id: "intro",
          title: "Intro",
          text: "Text",
          trigger: { kind: "tick", definitionId: "arc-trooper" },
        },
      ];
    },
    "placement or actor trigger",
  ],
  [
    "unknown popup actor",
    (file: any) => {
      file.scenario.popups = [
        {
          id: "intro",
          title: "Intro",
          text: "Text",
          trigger: { kind: "actor", definitionId: "dragon" },
        },
      ];
    },
    'popup uses unknown actor "dragon"',
  ],
  [
    "a placement popup naming a mobile actor",
    (file: any) => {
      file.scenario.popups = [
        {
          id: "intro",
          title: "Intro",
          text: "Text",
          trigger: { kind: "placement", definitionId: "arc-trooper" },
        },
      ];
    },
    "require a building definition",
  ],
  [
    "dismissal of an unknown popup",
    (file: any) => {
      file.state.dismissedPopups = ["intro"];
    },
    "scenario's popups",
  ],
  [
    "a flock without birds",
    (file: any) => {
      file.scenario.flocks = [
        {
          center: { x: 0, z: 0 },
          radius: 4,
          altitude: 3,
          count: -1,
          lapSeconds: 20,
        },
      ];
    },
    "Scenario flocks need",
  ],
  [
    "a flock without a center",
    (file: any) => {
      file.scenario.flocks = [
        { radius: 4, altitude: 3, count: 2, lapSeconds: 20 },
      ];
    },
    "Scenario flocks need",
  ],
  [
    "invalid metadata",
    (file: any) => {
      file.save = { name: "Save", savedAt: "yesterday" };
    },
    "timestamp",
  ],
  [
    "zero map width",
    (file: any) => {
      file.state.terrain.width = 0;
    },
    "width",
  ],
  [
    "overflowing height",
    (file: any) => {
      file.state.terrain.heights[0][0] = 1e40;
    },
    "numbers",
  ],
  [
    "invalid retired ID",
    (file: any) => {
      file.state.retiredActorIds = [null];
    },
    "retiredActorIds",
  ],
])("rejects %s before starting a session", (_name, edit, message) => {
  const file = JSON.parse(LEVEL_SOURCES.get("sandbox")!);
  edit(file);
  expect(() => loadMission(JSON.stringify(file))).toThrow(message);
});

test("normalizes Unicode legend characters before round-tripping", () => {
  const file = JSON.parse(serializeMission(scenario, testMission(), 1));
  file.state.terrain.legend["🌊"] = file.state.terrain.legend["~"];
  delete file.state.terrain.legend["~"];
  file.state.terrain.tiles[0] = "#.🌊";
  const parsed = parseMission(JSON.stringify(file), 1);
  expect(
    parseMission(serializeMission(parsed.scenario, parsed.state, 1), 1).state,
  ).toEqual(parsed.state);
});

test("a complete mission file continues identically with queued commands and paid production", () => {
  const mission = loadMission(LEVEL_SOURCES.get("arc-economy-opening")!);
  const simulate = (loaded: typeof mission) =>
    createSessionSimulation(
      createScenarioMap({ ...loaded.scenario, terrain: loaded.state.terrain }),
      loaded,
    );
  const original = simulate(mission);
  original.submitCommand({
    kind: "place-actor",
    actorId: "refinery",
    definitionId: "arc-materials-refinery",
    origin: { x: 12, z: 49 },
  });
  for (let tick = 0; tick < 490; tick++) original.tick();
  original.submitCommand({
    kind: "train-unit",
    actorId: "worker",
    producerId: "refinery",
    definitionId: "arc-harvester",
  });
  const restored = simulate(
    loadMission(
      serializeMission(
        mission.scenario,
        original.snapshot(),
        SIMULATION_TICK_SECONDS,
      ),
    ),
  );
  try {
    expect(restored.snapshot()).toEqual(original.snapshot());
    for (let tick = 0; tick < 900; tick++) {
      original.tick();
      restored.tick();
      if (tick % 60 === 0)
        expect(restored.snapshot()).toEqual(original.snapshot());
    }
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.actorById("worker")).toBeDefined();
  } finally {
    original.dispose();
    restored.dispose();
  }
});

test("maps with more terrain kinds than the ASCII legend can still be saved", () => {
  const terrainTypeIds = Array.from(
    { length: 100 },
    (_, index) => `type-${index}`,
  );
  const map = new TerrainGrid({
    width: 100,
    height: 1,
    tileSize: 1,
    terrainTypeIds,
    createTerrain: (x) => ({ typeId: terrainTypeIds[x] }),
  });
  const state = {
    ...createMissionState([]),
    scenarioId: "test",
    terrain: map.terrainState(),
  };
  const source = serializeMission({ ...scenario, terrainTypeIds }, state, 1);
  expect(parseMission(source, 1).state).toEqual(state);
});

test("invalid building debris is rejected before it can crash rendering", () => {
  const file = JSON.parse(LEVEL_SOURCES.get("sandbox")!);
  file.state.tick = 1;
  file.state.retiredActorIds = ["destroyed-barracks"];
  file.state.wrecks = [
    {
      actorId: "destroyed-barracks",
      definitionId: "arc-field-barracks",
      worldPosition: { x: 0, z: 0 },
      facing: 0,
      tick: 0,
      tilePlacement: { origin: { x: 100, z: 100 }, quarterTurns: 0 },
    },
  ];
  expect(() => loadMission(JSON.stringify(file))).toThrow("invalid wrecks");
});

test("serialization preserves signed zero in authoritative state", () => {
  const state = testMission();
  state.terrain.heights[0] = -0;
  state.commands.push({
    tick: 0,
    command: { kind: "move", actorId: "unit", target: { x: -0, z: 0 } },
  });
  expect(parseMission(serializeMission(scenario, state, 1), 1).state).toEqual(
    state,
  );
});

test("mission tick rates must be finite numbers", () => {
  const file = JSON.parse(serializeMission(scenario, testMission(), 1));
  file.ticksPerSecond = "1";
  expect(() => parseMission(JSON.stringify(file), 1)).toThrow(
    "ticks per second",
  );
  for (const seconds of [0, -1, NaN, Infinity]) {
    expect(() => serializeMission(scenario, testMission(), seconds)).toThrow(
      "tick seconds",
    );
    expect(() => parseMission("{}", seconds)).toThrow("tick seconds");
  }
});

test("dismissed popups and bird flocks survive saving and loading", () => {
  const mission = loadMission(LEVEL_SOURCES.get("arc-economy-opening")!);
  expect(mission.scenario.flocks).toHaveLength(1);
  expect(mission.scenario.popups?.map(({ id }) => id)).toEqual([
    "support-network",
    "harvester-operations",
  ]);
  const source = serializeMission(
    mission.scenario,
    { ...mission.state, dismissedPopups: ["harvester-operations"] },
    SIMULATION_TICK_SECONDS,
  );
  const loaded = loadMission(source);
  expect(loaded.state.dismissedPopups).toEqual(["harvester-operations"]);
  expect(loaded.scenario.flocks).toEqual(mission.scenario.flocks);
});

test.each([
  { center: null },
  { center: { x: "1", z: 0 } },
  { radius: 0 },
  { radius: -1 },
  { altitude: 0 },
  { altitude: -1 },
  { count: 0.5 },
  { count: -1 },
  { lapSeconds: 0 },
])("rejects invalid bird flocks: %j", (change) => {
  const file = JSON.parse(serializeMission(scenario, testMission(), 1));
  file.scenario.flocks = [
    {
      center: { x: 0, z: 0 },
      radius: 1,
      altitude: 2,
      count: 3,
      lapSeconds: 10,
      ...change,
    },
  ];
  expect(() => parseMission(JSON.stringify(file), 1)).toThrow(
    "Scenario flocks",
  );
});
