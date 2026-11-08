import { DIFFICULTIES, DIFFICULTY_IDS } from "../simulation/mission-setup";
import { createElement, mountFeature } from "./dom";
import markup from "./mission-setup.html?raw";
import "./mission-setup.css";

import type { Difficulty } from "../simulation/mission-setup";

export type SetupFaction = "arc" | "circle";

/** Difficulty and faction choices for a new mission. */
export function createMissionSetup(
  root: HTMLElement,
  host: {
    start: (faction: SetupFaction, difficulty: Difficulty) => void;
    /** Returns to the menu actions. */
    back: () => void;
  },
) {
  return mountFeature(root, markup, ({ signal, element }) => {
    const click = (control: HTMLElement, action: () => void) =>
      control.addEventListener("click", action, { signal });
    let difficulty: Difficulty = "normal";
    const choices = DIFFICULTY_IDS.map((id) => {
      const button = createElement(
        "button",
        { id: `difficulty-${id}`, class: "setup-choice", type: "button" },
        createElement("strong", {}, DIFFICULTIES[id].name),
      );
      element("difficulty-choices").append(button);
      click(button, () => select(id));
      return { id, button };
    });
    const select = (selected: Difficulty) => {
      difficulty = selected;
      for (const { id, button } of choices)
        button.setAttribute("aria-pressed", String(id === selected));
    };
    select(difficulty);
    click(element("choose-arc"), () => host.start("arc", difficulty));
    click(element("choose-circle"), () => host.start("circle", difficulty));
    click(element("cancel-mission-setup"), host.back);
    return {
      /** Panel content and opening focus, for the dialog's panel switching. */
      panels: {
        setup: {
          content: element("mission-setup"),
          focus: () => element("choose-arc"),
          title: "Set up your mission",
          description:
            "Choose a difficulty, then a faction, for the wolf-den demo.",
        },
      },
    };
  });
}
