import { DIFFICULTIES, DIFFICULTY_IDS } from "../simulation/mission-setup";
import { createElement, mountFeature } from "./dom";
import markup from "./mission-setup.html?raw";
import "./mission-setup.css";

import type { Difficulty } from "../simulation/mission-setup";
import type { SkirmishFaction } from "../content/skirmish-map";

type SetupMode = "introduction" | "skirmish";
export type MissionChoice = {
  mode: SetupMode;
  faction: SkirmishFaction;
  difficulty: Difficulty;
};

const FACTION_DESCRIPTIONS: Record<
  SetupMode,
  Record<SkirmishFaction, string>
> = {
  introduction: {
    arc: "ARC introduction. Establish a base, gather Materials, and train a force to clear the wolf den.",
    circle:
      "Circle introduction. Grow a living base, cultivate Lifebloom, and raise an army.",
  },
  skirmish: {
    arc: "Command ARC against a Circle base. Expand, defend your Harvesters, and destroy the rival base.",
    circle:
      "Lead the Circle against an ARC base. Spread cultivation, raise defenders, and destroy the rival base.",
  },
};

/** Independent mission, faction, and difficulty choices for a new mission. */
export function createMissionSetup(
  root: HTMLElement,
  host: {
    start: (choice: MissionChoice) => void;
    /** Returns to the menu actions. */
    back: () => void;
  },
) {
  return mountFeature(root, markup, ({ signal, element }) => {
    const click = (control: HTMLElement, action: () => void) =>
      control.addEventListener("click", action, { signal });
    const choice: MissionChoice = {
      mode: "introduction",
      faction: "arc",
      difficulty: "normal",
    };
    /** Pressing a button in a group selects its value. */
    function group<K extends keyof MissionChoice>(
      key: K,
      buttons: readonly { id: MissionChoice[K]; button: HTMLElement }[],
      onSelect?: () => void,
    ) {
      const sync = () => {
        for (const { id, button } of buttons)
          button.setAttribute("aria-pressed", String(id === choice[key]));
      };
      for (const { id, button } of buttons)
        click(button, () => {
          choice[key] = id;
          sync();
          onSelect?.();
        });
      sync();
    }
    const describeFactions = () => {
      for (const [faction, text] of Object.entries(
        FACTION_DESCRIPTIONS[choice.mode],
      ))
        element(`choose-${faction}-description`).textContent = text;
    };
    group(
      "mode",
      [
        { id: "introduction", button: element("mission-introduction") },
        { id: "skirmish", button: element("mission-skirmish") },
      ],
      describeFactions,
    );
    group("faction", [
      { id: "arc", button: element("choose-arc") },
      { id: "circle", button: element("choose-circle") },
    ]);
    group(
      "difficulty",
      DIFFICULTY_IDS.map((id) => {
        const button = createElement(
          "button",
          { id: `difficulty-${id}`, class: "setup-choice", type: "button" },
          createElement("strong", {}, DIFFICULTIES[id].name),
        );
        element("difficulty-choices").append(button);
        return { id, button };
      }),
    );
    describeFactions();
    click(element("start-mission"), () => host.start({ ...choice }));
    click(element("cancel-mission-setup"), host.back);
    return {
      /** Panel content and opening focus, for the dialog's panel switching. */
      panels: {
        setup: {
          content: element("mission-setup"),
          focus: () => element("mission-introduction"),
          title: "Set up your mission",
          description:
            "Choose a wolf-den introduction or a skirmish against the other faction's AI.",
        },
      },
    };
  });
}
