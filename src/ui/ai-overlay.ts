import { createElement as el } from "./dom";
import { formatElapsed } from "../format-time";
import { aiDiagnostics } from "../simulation/director";
import "./ai-overlay.css";

import type { CommandOutcome } from "../simulation/command";
import type { AiAssignment } from "../simulation/director";
import type { MissionSimulation } from "../simulation/mission";

const REFRESH_MILLISECONDS = 250;
const RECENT_COMMANDS = 10;
const RECENT_SIGHTINGS = 8;
const MEMORY_CHARACTERS = 400;

export type AiOverlaySource = Pick<
  MissionSimulation,
  "ai" | "completedTicks" | "tickSeconds" | "viewOf" | "observeTicks"
>;

export type AiOverlaySection = { title: string; lines: string[] };

const amount = (value: number) => value.toFixed(1).replace(/\.0$/, "");

/**
 * Describes one AI owner's strategy, commands, and memory as text lines.
 * `recent` holds the owner's latest command outcomes, oldest first.
 */
export function describeAi(
  source: Omit<AiOverlaySource, "observeTicks">,
  owner: string,
  recent: readonly CommandOutcome[] = [],
): AiOverlaySection[] {
  const state = source.ai[owner];
  if (!state) return [];
  const { posture, requestedPosture, budgets, claims, rejections, memory } =
    aiDiagnostics(state);
  const tick = source.completedTicks;
  const age = (seen: number) =>
    formatElapsed((tick - seen) * source.tickSeconds);
  const listed = (lines: string[]) => (lines.length ? lines : ["none"]);
  const { observations } = source.viewOf(owner).knowledge;
  const sightings = [...observations.actors]
    .sort((a, b) => b.tick - a.tick)
    .slice(0, RECENT_SIGHTINGS);
  return [
    {
      title: "Strategy",
      lines: [
        `posture ${posture}${requestedPosture ? ` → ${requestedPosture}` : ""}`,
        state.cursor === undefined
          ? `next round at tick ${state.nextRoundTick}`
          : `round in progress, concern ${state.cursor + 1}`,
        `tick ${tick}`,
      ],
    },
    {
      title: "Budgets",
      lines: listed(
        Object.entries(budgets).map(
          ([concern, funds]) =>
            `${concern}: ${
              Object.entries(funds)
                .map(([resource, value]) => `${resource} ${amount(value!)}`)
                .join(", ") || "empty"
            }`,
        ),
      ),
    },
    {
      title: "Forces",
      lines: listed(
        Object.entries(claims).map(
          ([concern, count]) => `${concern}: ${count} claimed`,
        ),
      ),
    },
    {
      title: "Commands",
      lines: listed(
        recent.map(
          ({ tick: at, command, accepted, reason }) =>
            `${at} ${command.kind} ${accepted ? "ok" : `refused${reason ? ` (${reason})` : ""}`}`,
        ),
      ),
    },
    {
      title: "Waiting refusals",
      lines: listed(
        rejections.map(
          ({ concern, tick: at, kind, reason }) =>
            `${concern}: ${kind} at ${at}${reason ? ` (${reason})` : ""}`,
        ),
      ),
    },
    {
      title: "Memory",
      lines: listed(
        Object.entries(memory).map(([concern, value]) => {
          const text = JSON.stringify(value);
          return `${concern}: ${text.length > MEMORY_CHARACTERS ? `${text.slice(0, MEMORY_CHARACTERS)}…` : text}`;
        }),
      ),
    },
    {
      title: "Observations",
      lines: [
        `${observations.actors.length} actors, ${observations.sites.length} sites, ${observations.loot.length} loot`,
        ...sightings.map(
          ({ definitionId, owner: seenOwner, worldPosition, tick: seen }) =>
            `${definitionId} (${seenOwner}) at ${Math.round(worldPosition.x)},${Math.round(worldPosition.z)}, ${age(seen)} ago`,
        ),
      ],
    },
  ];
}

/**
 * A development panel over the world view for the mission's AI owners. Each
 * `toggle` shows the next owner, then hides the panel after the last one.
 */
export function createAiOverlay(
  host: HTMLElement,
  source: AiOverlaySource,
  controllers: readonly AiAssignment[],
) {
  const owners = controllers.map(({ owner }) => owner);
  const profiles = new Map(
    controllers.map(({ owner, profileId }) => [owner, profileId]),
  );
  const recent = new Map<string, CommandOutcome[]>(
    owners.map((owner) => [owner, []]),
  );
  const panel = el("section", {
    id: "ai-overlay",
    class: "ai-overlay",
    "aria-label": "AI diagnostics",
    hidden: true,
  });
  host.append(panel);
  let shown: number | undefined;
  let dirty = true;
  const render = () => {
    if (shown === undefined || !dirty) return;
    dirty = false;
    const owner = owners[shown]!;
    panel.dataset.owner = owner;
    panel.replaceChildren(
      el("h2", {}, `AI ${owner} · ${profiles.get(owner)}`),
      ...describeAi(source, owner, recent.get(owner)).map(({ title, lines }) =>
        el(
          "section",
          {},
          el("h3", {}, title),
          el("ul", {}, ...lines.map((line) => el("li", {}, line))),
        ),
      ),
    );
  };
  const stopObserving = source.observeTicks({
    afterTick: (outcomes) => {
      for (const outcome of outcomes) {
        const log = outcome.issuer.ai && recent.get(outcome.issuer.owner);
        if (!log) continue;
        log.push(outcome);
        if (log.length > RECENT_COMMANDS) log.shift();
      }
      dirty = true;
    },
  });
  const timer = setInterval(render, REFRESH_MILLISECONDS);
  return {
    toggle: () => {
      shown =
        shown === undefined
          ? 0
          : shown + 1 < owners.length
            ? shown + 1
            : undefined;
      panel.hidden = shown === undefined;
      dirty = true;
      render();
    },
    dispose: () => {
      clearInterval(timer);
      stopObserving();
      panel.remove();
    },
  };
}
