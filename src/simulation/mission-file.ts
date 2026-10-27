import type { MissionState } from "./mission";
import type { ObjectiveDefinition } from "./objectives";
import { isTerrainTileShape } from "./terrain";
import { isCount, isId, isIdList, isPositive, isRecord } from "./validation";

import type { TerrainState, TerrainTile } from "./terrain";
import { isFinitePosition } from "./world";
import type { WorldPosition } from "./world";

const FORMAT = "cotuw-mission";
export const MISSION_FILE_VERSION = 9;
/** Lines that fit within this width stay on one line. */
const LINE_WIDTH = 80;

/** A sidebar step that counts the player's actors of one definition. */
export type ScenarioGoal = {
  definitionId: string;
  label: string;
  directive?: string;
};

/** Sidebar text that introduces a scenario. */
export type ScenarioBriefing = {
  label: string;
  title: string;
  description: string;
  goalsHeading: string;
  goalsNote: string;
  rules: string;
};

/**
 * A dismissible explanation shown the first time its trigger holds: while the
 * player places a building of the definition, or owns a completed actor of it.
 */
export type ScenarioPopup = {
  id: string;
  title: string;
  text: string;
  trigger: { kind: "placement" | "actor"; definitionId: string };
};

/** Ambient birds circling a world point; presentation only. */
export type BirdFlock = {
  center: WorldPosition;
  radius: number;
  /** Height above the highest terrain under the loop. */
  altitude: number;
  count: number;
  lapSeconds: number;
};

/** Authored content that stays fixed during a mission and travels with it. */
export type MissionScenario = {
  readonly id: string;
  /** The content pack, and its version, that supplies rules and presentation. */
  readonly content?: { readonly id: string; readonly version: number };
  /** The pack's actor definitions this mission uses; absent uses them all. */
  readonly actors?: readonly string[];
  readonly name?: string;
  readonly tileSize: number;
  readonly terrainTypeIds: readonly string[];
  readonly objectives?: readonly ObjectiveDefinition[];
  readonly briefing?: Readonly<ScenarioBriefing>;
  readonly goals?: readonly ScenarioGoal[];
  readonly popups?: readonly ScenarioPopup[];
  readonly flocks?: readonly BirdFlock[];
};

export type SaveInfo = { name: string; savedAt: string };

/** A level is a mission file at tick 0; a save is the same format later on. */
export type MissionFile = {
  scenario: MissionScenario;
  state: MissionState & { terrain: TerrainState };
  /** Absent from authored levels. */
  save?: SaveInfo;
};

/** Terrain as text: rows run north to south, and columns west to east. */
type TerrainText = {
  width: number;
  height: number;
  navigationVersion: number;
  legend: Record<string, TerrainTile>;
  tiles: string[];
  /** Corner heights, one more row and column than tiles. */
  heights: number[][];
};

const PREFERRED_SYMBOLS = new Map([
  ['{"typeId":"plain"}', "."],
  ['{"typeId":"path"}', "="],
  ['{"typeId":"rough"}', ","],
  ['{"typeId":"water"}', "~"],
  ['{"typeId":"plain","outOfBounds":true}', "#"],
]);
const SPARE_SYMBOLS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-*/:;!?@$%&";

export function serializeMission(
  scenario: MissionScenario,
  state: MissionState,
  tickSeconds: number,
  save?: SaveInfo,
): string {
  if (!isPositive(tickSeconds))
    throw new RangeError("Mission tick seconds must be positive and finite.");
  const { terrain, fog } = state;
  if (!terrain) throw new RangeError("A mission file requires its terrain.");
  if (state.scenarioId !== scenario.id)
    throw new RangeError("The mission state belongs to a different scenario.");
  const {
    id,
    content,
    actors,
    name,
    tileSize,
    terrainTypeIds,
    objectives,
    briefing,
    goals,
    popups,
    flocks,
  } = scenario;
  return formatJson({
    format: FORMAT,
    version: MISSION_FILE_VERSION,
    ticksPerSecond: 1 / tickSeconds,
    save,
    scenario: {
      id,
      content,
      actors,
      name,
      tileSize,
      terrainTypeIds,
      objectives,
      briefing,
      goals,
      popups,
      flocks,
    },
    state: {
      ...state,
      terrain: terrainToText(terrain),
      fog: fog && {
        explored: northToSouth(fog.explored, terrain.width, terrain.height),
      },
    },
  });
}

/**
 * Parses a level or save and checks its format. Simulation initialization
 * validates the returned state.
 */
export function parseMission(source: string, tickSeconds: number): MissionFile {
  if (!isPositive(tickSeconds))
    throw new RangeError("Mission tick seconds must be positive and finite.");
  let file;
  try {
    file = JSON.parse(source);
  } catch (error) {
    throw new RangeError(
      `This mission file is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (file?.format !== FORMAT)
    throw new RangeError("This file is not a mission file.");
  if (file.version !== MISSION_FILE_VERSION)
    throw new RangeError(
      `This mission file uses version ${file.version}; this build reads version ${MISSION_FILE_VERSION}.`,
    );
  if (
    !isPositive(file.ticksPerSecond) ||
    1 / file.ticksPerSecond !== tickSeconds
  )
    throw new RangeError(
      `This mission file runs at ${file.ticksPerSecond} ticks per second; this build runs at ${1 / tickSeconds}.`,
    );
  const { scenario, state, save } = file;
  if (
    !isRecord(scenario) ||
    !isId(scenario.id) ||
    !isPositive(scenario.tileSize) ||
    !isIdList(scenario.terrainTypeIds) ||
    scenario.terrainTypeIds.length === 0
  )
    throw new RangeError(
      "A mission file needs a scenario ID, tile size, and terrain types.",
    );
  if (
    scenario.content !== undefined &&
    (!isRecord(scenario.content) ||
      !isId(scenario.content.id) ||
      !isCount(scenario.content.version))
  )
    throw new RangeError("The scenario needs a content pack ID and version.");
  if (scenario.actors !== undefined && !isIdList(scenario.actors))
    throw new RangeError("Scenario actors must be distinct actor IDs.");
  if (scenario.name !== undefined && typeof scenario.name !== "string")
    throw new RangeError("The scenario name must be text.");
  const briefing = scenario.briefing;
  if (
    briefing !== undefined &&
    (!isRecord(briefing) ||
      [
        "label",
        "title",
        "description",
        "goalsHeading",
        "goalsNote",
        "rules",
      ].some((key) => typeof briefing[key] !== "string"))
  )
    throw new RangeError("The scenario briefing needs text for every field.");
  if (
    scenario.goals !== undefined &&
    (!Array.isArray(scenario.goals) ||
      scenario.goals.some(
        (goal) =>
          !isRecord(goal) ||
          !isId(goal.definitionId) ||
          typeof goal.label !== "string" ||
          (goal.directive !== undefined && typeof goal.directive !== "string"),
      ))
  )
    throw new RangeError("Scenario goals need an actor ID and text.");
  const popups = scenario.popups;
  if (
    popups !== undefined &&
    (!Array.isArray(popups) ||
      !isIdList(popups.map((popup) => popup?.id)) ||
      popups.some(
        ({ title, text, trigger }) =>
          typeof title !== "string" ||
          typeof text !== "string" ||
          !isRecord(trigger) ||
          !["placement", "actor"].includes(trigger.kind as string) ||
          !isId(trigger.definitionId),
      ))
  )
    throw new RangeError(
      "Scenario popups need distinct IDs, text, and a placement or actor trigger.",
    );
  const dismissed = state?.dismissedPopups;
  if (
    dismissed !== undefined &&
    (!isIdList(dismissed) ||
      dismissed.some(
        (id) => !popups?.some((popup: ScenarioPopup) => popup.id === id),
      ))
  )
    throw new RangeError(
      "Dismissed popups must be distinct IDs of the scenario's popups.",
    );
  if (
    scenario.flocks !== undefined &&
    (!Array.isArray(scenario.flocks) ||
      scenario.flocks.some(
        (flock) =>
          !isRecord(flock) ||
          !isFinitePosition(flock.center) ||
          !isPositive(flock.radius) ||
          !isPositive(flock.altitude) ||
          !isCount(flock.count) ||
          !isPositive(flock.lapSeconds),
      ))
  )
    throw new RangeError(
      "Scenario flocks need a center, radius, altitude, count, and lap time.",
    );
  if (scenario.objectives !== undefined && !Array.isArray(scenario.objectives))
    throw new RangeError("Scenario objectives must be a list.");
  if (
    save !== undefined &&
    (!isRecord(save) ||
      typeof save.name !== "string" ||
      typeof save.savedAt !== "string" ||
      !Number.isFinite(Date.parse(save.savedAt)))
  )
    throw new RangeError("Save metadata needs a name and valid timestamp.");
  if (state?.scenarioId !== scenario.id)
    throw new RangeError(
      "The mission state's scenarioId must match the scenario's id.",
    );
  const terrain = terrainFromText(state.terrain, scenario.terrainTypeIds);
  const parsed = { ...state, terrain };
  if (state.fog)
    parsed.fog = {
      explored: fogFromText(state.fog.explored, terrain.width, terrain.height),
    };
  return { scenario: scenario as MissionScenario, state: parsed, save };
}

function terrainToText(terrain: TerrainState): TerrainText {
  const { width, height } = terrain;
  const legend: Record<string, TerrainTile> = {};
  const symbols = new Map<string, string>();
  const symbolFor = (tile: TerrainTile) => {
    const { typeId, surfacePassable, surfaceBuildable, outOfBounds } = tile;
    const normalized = {
      typeId,
      surfacePassable,
      surfaceBuildable,
      outOfBounds,
    };
    const key = JSON.stringify(normalized);
    let symbol = symbols.get(key);
    if (!symbol) {
      const preferred = PREFERRED_SYMBOLS.get(key);
      symbol =
        preferred && !(preferred in legend)
          ? preferred
          : [...SPARE_SYMBOLS].find((spare) => !(spare in legend));
      // Private-use symbols keep larger custom maps round-trippable.
      if (!symbol) symbol = String.fromCodePoint(0xe000 + symbols.size);
      symbols.set(key, symbol);
      legend[symbol] = JSON.parse(key);
    }
    return symbol;
  };
  const row = terrain.tiles.map(symbolFor).join("");
  return {
    width,
    height,
    navigationVersion: terrain.navigationVersion,
    legend,
    tiles: northToSouth(row, width, height),
    heights: Array.from({ length: height + 1 }, (_, index) => {
      const start = (height - index) * (width + 1);
      return terrain.heights
        .slice(start, start + width + 1)
        .map(shortestFloat32);
    }),
  };
}

function terrainFromText(
  text: TerrainText | undefined,
  terrainTypeIds: readonly string[],
): TerrainState {
  const { width, height, legend, tiles, heights, navigationVersion } =
    text ?? {};
  if (
    !isCount(width) ||
    width === 0 ||
    !isCount(height) ||
    height === 0 ||
    !isCount(navigationVersion) ||
    !isRecord(legend) ||
    !Array.isArray(tiles) ||
    !Array.isArray(heights)
  )
    throw new RangeError(
      "Mission terrain needs a width, height, navigationVersion, legend, tiles, and heights.",
    );
  for (const [symbol, tile] of Object.entries(legend)) {
    if ([...symbol].length !== 1)
      throw new RangeError("Each terrain legend key must be one character.");
    if (!isTerrainTileShape(tile) || !terrainTypeIds.includes(tile.typeId))
      throw new RangeError(
        `Terrain legend "${symbol}" needs a typeId listed in terrainTypeIds.`,
      );
  }
  const tileRows = rowsFromText(tiles, width!, height!, "tile");
  if (
    heights.length !== height! + 1 ||
    heights.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== width! + 1 ||
        !row.every(
          (value) =>
            Number.isFinite(Math.fround(value)) && typeof value === "number",
        ),
    )
  )
    throw new RangeError(
      `Mission terrain needs ${height! + 1} height rows of ${width! + 1} numbers.`,
    );
  return {
    width: width!,
    height: height!,
    // Heights are 32-bit, so the shortest decimal restores the exact value.
    heights: [...heights].reverse().flat().map(Math.fround),
    tiles: tileRows.flatMap((row, z) =>
      [...row].map((symbol, x) => {
        const tile = legend[symbol];
        if (!tile)
          throw new RangeError(
            `Terrain tile (${x}, ${z}) uses "${symbol}", which the legend lacks.`,
          );
        return { ...tile };
      }),
    ),
    navigationVersion: navigationVersion!,
  };
}

function fogFromText(rows: unknown, width: number, height: number): string {
  const explored = rowsFromText(rows, width, height, "explored").join("");
  if (!/^[01]*$/.test(explored))
    throw new RangeError("Explored rows may contain only 0 and 1.");
  return explored;
}

/** Text rows, south to north, after checking their shape. */
function rowsFromText(
  rows: unknown,
  width: number,
  height: number,
  name: string,
): string[] {
  if (
    !Array.isArray(rows) ||
    rows.length !== height ||
    rows.some((row) => typeof row !== "string" || [...row].length !== width)
  )
    throw new RangeError(
      `Mission terrain needs ${height} ${name} rows of ${width} characters.`,
    );
  return [...rows].reverse();
}

/** Splits south-to-north row-major text into rows from north to south. */
function northToSouth(text: string, width: number, height: number): string[] {
  const characters = [...text];
  return Array.from({ length: height }, (_, index) => {
    const start = (height - 1 - index) * width;
    return characters.slice(start, start + width).join("");
  });
}

/** The shortest decimal that restores the same 32-bit height. */
function shortestFloat32(value: number): number {
  const target = Math.fround(value);
  for (let digits = 1; digits < 17; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (Object.is(Math.fround(candidate), target)) return candidate;
  }
  return value;
}

/** Indented JSON that keeps short values and number rows on one line. */
function formatJson(value: unknown, indent = "", prefix = 0): string {
  const inline = inlineJson(value);
  if (
    typeof value !== "object" ||
    value === null ||
    indent.length + prefix + inline.length <= LINE_WIDTH ||
    (Array.isArray(value) && value.every((item) => typeof item === "number"))
  )
    return inline;
  const inner = `${indent}  `;
  const lines = Array.isArray(value)
    ? value.map((item) => formatJson(item ?? null, inner))
    : jsonEntries(value).map(([key, item]) => {
        const label = `${JSON.stringify(key)}: `;
        return label + formatJson(item, inner, label.length);
      });
  const [open, close] = Array.isArray(value) ? "[]" : "{}";
  return `${open}\n${inner}${lines.join(`,\n${inner}`)}\n${indent}${close}`;
}

function inlineJson(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (Array.isArray(value))
    return `[${value.map((item) => inlineJson(item ?? null)).join(", ")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const entries = jsonEntries(value).map(
    ([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`,
  );
  return entries.length ? `{ ${entries.join(", ")} }` : "{}";
}

/** Object entries that JSON keeps, dropping undefined values. */
function jsonEntries(value: object): [string, unknown][] {
  return Object.entries(value).filter(
    ([, item]) => JSON.stringify(item) !== undefined,
  );
}
