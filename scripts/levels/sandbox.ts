import { PROTOTYPE_TERRAIN } from "./m0-terrain.ts";
import { createSandboxLevel } from "./sandbox-level.ts";

export const SANDBOX_LEVEL = createSandboxLevel({
  id: "sandbox",
  name: "Build & explore",
  terrain: PROTOTYPE_TERRAIN,
  briefing: {
    label: "Base & infantry sandbox",
    title: "Build & explore",
    description:
      "Practice construction and training. This sandbox has no victory or defeat condition.",
    goalsHeading: "Construction & training",
    goalsNote: "Counts show buildings and units currently in the field.",
  },
  goals: [
    {
      definitionId: "arc-command-center-prototype",
      label: "Place a Command Center",
    },
    { definitionId: "arc-field-barracks", label: "Build a Field Barracks" },
    { definitionId: "arc-trooper", label: "Train a Trooper" },
    { definitionId: "arc-scout", label: "Train a Scout" },
  ],
});
