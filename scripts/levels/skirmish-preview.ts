import { createSandboxLevel } from "./sandbox-level.ts";
import { SKIRMISH_TERRAIN } from "./skirmish-map.ts";

export const SKIRMISH_PREVIEW = createSandboxLevel({
  id: "skirmish-map",
  name: "Skirmish map preview",
  terrain: SKIRMISH_TERRAIN,
  savePolicy: "skirmish",
  briefing: {
    label: "Development map preview",
    title: "Survey the skirmish battlefield",
    description:
      "Explore the west and east start areas and the three ridge crossings. Place buildings and train units to inspect routes and base space.",
    goalsHeading: "Map inspection",
    goalsNote: "The full map is visible for inspection.",
  },
});
