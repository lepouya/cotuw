import { expect, test } from "vitest";

import { duePopup } from "../src/ui/popups";

import type { ScenarioPopup } from "../src/simulation/mission-file";

const popups: ScenarioPopup[] = [
  {
    id: "network",
    title: "Network",
    text: "",
    trigger: { kind: "placement", definitionId: "refinery" },
  },
  {
    id: "harvester",
    title: "Harvester",
    text: "",
    trigger: { kind: "actor", definitionId: "harvester" },
  },
];

test("popups wait for their trigger and never return once dismissed", () => {
  const none = () => false;
  expect(duePopup(popups, new Set(), { owns: none })).toBeUndefined();
  expect(
    duePopup(popups, new Set(), { placing: "barracks", owns: none }),
  ).toBeUndefined();
  expect(
    duePopup(popups, new Set(), { placing: "refinery", owns: none })?.id,
  ).toBe("network");
  const ownsHarvester = (id: string) => id === "harvester";
  expect(
    duePopup(popups, new Set(["network"]), {
      placing: "refinery",
      owns: ownsHarvester,
    })?.id,
  ).toBe("harvester");
  expect(
    duePopup(popups, new Set(["network", "harvester"]), {
      placing: "refinery",
      owns: ownsHarvester,
    }),
  ).toBeUndefined();
});
