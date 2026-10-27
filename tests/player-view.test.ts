import { expect, test } from "vitest";

import { createActor } from "../src/simulation/actor";
import { createPlayerView } from "../src/simulation/player-view";
import { createRelations } from "../src/simulation/ownership";

import type {
  ActorDefinition,
  ActorRenderState,
} from "../src/simulation/actor";
import type { Detectable } from "../src/simulation/ownership";

const movement = { speed: 1, profileId: "ground" };
const definitions = new Map<string, ActorDefinition>(
  [
    { id: "trooper", behaviorId: "move", faction: "arc", movement },
    { id: "barracks", behaviorId: "idle", faction: "arc" },
    { id: "wolf", behaviorId: "move", faction: "wildlife", movement },
  ].map((definition) => [definition.id, definition]),
);
const actor = (
  id: string,
  definitionId: string,
  owner: string,
): ActorRenderState =>
  createActor({ id, definitionId, owner, worldPosition: { x: 0, z: 0 } });
const barracks: ActorRenderState = {
  ...actor("barracks", "barracks", "player"),
  tilePlacement: { origin: { x: 0, z: 0 }, quarterTurns: 0 },
};

function fixture() {
  const simulation = {
    actors: [
      actor("trooper", "trooper", "player"),
      barracks,
      actor("wolf", "wolf", "wildlife"),
    ],
    playerOwner: "player",
    relations: createRelations([
      { owners: ["player", "wildlife"], relationship: "hostile" },
    ]),
    seen: new Set<string>(),
    detects: (_owner: string | undefined, target: Detectable) =>
      simulation.seen.has(target.id!),
  };
  return { simulation, player: createPlayerView(simulation, definitions) };
}

test("hidden hostiles stay out of the player's lookups and groups", () => {
  const { simulation, player } = fixture();

  expect(player.actor("wolf")?.id).toBe("wolf");
  expect(player.shownActor("wolf")).toBeUndefined();
  expect(player.shownActor("trooper")?.id).toBe("trooper");
  expect(player.actors().shownMobile.map(({ id }) => id)).toEqual(["trooper"]);
  expect(player.actors().mobile.map(({ id }) => id)).toEqual([
    "trooper",
    "wolf",
  ]);

  simulation.seen.add("wolf");
  expect(player.shownActor("wolf")?.id).toBe("wolf");
});

test("own lookups exclude hostiles, and mobile ones exclude buildings", () => {
  const { player } = fixture();

  expect(player.ownActor("barracks")?.id).toBe("barracks");
  expect(player.ownActor("wolf")).toBeUndefined();
  expect(player.ownActor(undefined)).toBeUndefined();
  expect(player.ownMobileActor("trooper")?.id).toBe("trooper");
  expect(player.ownMobileActor("barracks")).toBeUndefined();
  expect([...player.actors().ownIds]).toEqual(["trooper", "barracks"]);
  expect(player.actors().placed.map(({ id }) => id)).toEqual(["barracks"]);
});

test("groups follow each committed actor list", () => {
  const { simulation, player } = fixture();
  const before = player.actors();
  expect(player.actors()).toBe(before);

  simulation.actors = simulation.actors.filter(({ id }) => id !== "trooper");

  expect(player.actor("trooper")).toBeUndefined();
  expect(player.actors().ownIds.has("trooper")).toBe(false);
});
