import { expect, test } from "vitest";

import { BASE_CONTENT } from "./helpers/content";
import { SKIRMISH_OPENINGS } from "../src/content/skirmish";
import { costAmount, costResource } from "../src/simulation/resources";

const definitions = new Map(
  BASE_CONTENT.actors.map((actor) => [actor.id, actor]),
);
const circleBuildings = [
  ["circle-heartgrove", "Heartgrove"],
  ["circle-conservatory", "Lifebloom Conservatory"],
  ["circle-musterhall", "Musterhall"],
] as const;
const circleUnits = [
  ["circle-cultivator", "Cultivator", "circle-heartgrove"],
  ["circle-sentinel", "Sentinel", "circle-musterhall"],
  ["circle-wayfinder", "Wayfinder", "circle-musterhall"],
] as const;

test.each(Object.entries(SKIRMISH_OPENINGS))(
  "%s prices its roster in its own common resource",
  (faction, { resource }) => {
    for (const actor of BASE_CONTENT.actors.filter(
      (actor) => actor.faction === faction,
    )) {
      expect(costAmount(actor), actor.id).toBeGreaterThan(0);
      expect(costResource(actor), actor.id).toBe(resource);
    }
  },
);

test.each(circleBuildings)(
  "%s has the selected name and Grow action",
  (id, name) => {
    expect(BASE_CONTENT.presentation[id]).toMatchObject({
      name,
      build: { label: `Grow ${name}` },
    });
  },
);

test.each(circleUnits)(
  "%s has the selected name, Train action, producer, and recovery kind",
  (id, name, producer) => {
    expect(BASE_CONTENT.presentation[id]).toMatchObject({
      name,
      train: { label: `Train ${name}` },
    });
    expect(definitions.get(producer)?.production?.unitDefinitionIds).toContain(
      id,
    );
    expect(definitions.get(id)?.recoveryKind).toBe("biological");
  },
);

test("each trainable unit has exactly one producer of its own faction", () => {
  const producers = BASE_CONTENT.actors.flatMap(({ id, faction, production }) =>
    (production?.unitDefinitionIds ?? []).map((unit) => ({
      id,
      faction,
      unit,
    })),
  );
  expect(new Set(producers.map(({ unit }) => unit)).size).toBe(
    producers.length,
  );
  for (const { id, faction, unit } of producers)
    expect(definitions.get(unit)?.faction, `${id} trains ${unit}`).toBe(
      faction,
    );
});

test("the Conservatory receives Lifebloom without training units", () => {
  expect(definitions.get("circle-conservatory")).toMatchObject({
    cultivationDropoff: true,
  });
  expect(definitions.get("circle-conservatory")?.production).toBeUndefined();
});

test("Circle infantry preserve the selected combat and scouting roles", () => {
  const trooper = definitions.get("arc-trooper")!;
  const sentinel = definitions.get("circle-sentinel")!;
  const wayfinder = definitions.get("circle-wayfinder")!;
  expect(sentinel.health).toBeGreaterThan(trooper.health!);
  expect(sentinel.weapon!.range).toBeLessThan(trooper.weapon!.range);
  expect(wayfinder.weapon).toBeUndefined();
  expect(wayfinder.health).toBeLessThan(sentinel.health!);
  expect(wayfinder.movement!.speed).toBeGreaterThan(sentinel.movement!.speed);
  expect(wayfinder.vision!.radius).toBeGreaterThan(sentinel.vision!.radius);
});
