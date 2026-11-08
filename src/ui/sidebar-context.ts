import { missionEnded } from "../simulation/mission-result";
import type { ActorDefinition } from "../simulation/actor";
import type { ObservedActor } from "../simulation/owner-view";
import type { Resource } from "../simulation/resources";
import type { Relations } from "../simulation/ownership";
import type { MissionResult } from "../simulation/mission-result";
import type { ObjectiveView } from "../simulation/objectives";
import type {
  ScenarioBriefing,
  ScenarioGoal,
} from "../simulation/mission-file";
import type { ActorPresentation } from "../content/content-pack";

export type SidebarState = {
  /** Own and currently detected actors only. */
  actors: readonly ObservedActor[];
  actorVersion: number;
  selectedActorIds: readonly string[];
  boxMode?: boolean;
  additiveMode?: boolean;
  queueMode?: boolean;
  placementActive: boolean;
  faulted: boolean;
  paused?: boolean;
  /** Whether the camera follows actors. */
  following?: boolean;
  canRemove: boolean;
  /** Present when the mission has an economy. */
  balances?: Partial<Record<Resource, number>>;
  /** The player's spending resource, shown in the top bar. */
  resource?: Resource;
  objectives?: readonly ObjectiveView[];
  result?: MissionResult;
  relations: Pick<Relations, "relationship">;
};

export type SidebarOptions = {
  definitions: readonly ActorDefinition[];
  economy?: boolean;
  presentations: ReadonlyMap<string, ActorPresentation>;
  goals: readonly ScenarioGoal[];
  briefing?: ScenarioBriefing;
  selectActor: (id: string, additive?: boolean) => void;
  playerOwner: string;
  /** The player's faction, whose roster supplies the construction menu. */
  playerFaction?: string;
  factionName?: string;
};

/** A composed part of the sidebar, refreshed with each state change. */
export type SidebarSection = { update: (state: SidebarState) => void };

/** Mission-lifetime content lookups and scope shared by sidebar sections. */
export function createSidebarContext(
  root: HTMLElement,
  options: SidebarOptions,
  signal: AbortSignal,
) {
  const nameFor = (id: string) => options.presentations.get(id)?.name ?? id;
  return {
    ...options,
    root,
    signal,
    definitionById: new Map(
      options.definitions.map((definition) => [definition.id, definition]),
    ),
    nameFor,
    trainedNames: (definition: ActorDefinition) =>
      definition.production!.unitDefinitionIds.map(nameFor),
    owns: (actor: Pick<ObservedActor, "owner">) =>
      actor.owner === options.playerOwner,
  };
}

export type SidebarContext = ReturnType<typeof createSidebarContext>;

/** The actor shown in detail, when exactly one visible actor is selected. */
export function inspectedActor({ actors, selectedActorIds }: SidebarState) {
  return selectedActorIds.length === 1
    ? actors.find(({ id }) => id === selectedActorIds[0])
    : undefined;
}

/** Whether world selection is locked; finished missions stay inspectable. */
export const selectionLocked = (state: SidebarState) =>
  state.placementActive || state.faulted;

/** Whether simulation orders are locked for this state. */
export const ordersLocked = (state: SidebarState) =>
  selectionLocked(state) || missionEnded(state.result);

export function countByDefinition(actors: Iterable<ObservedActor>) {
  const counts = new Map<string, number>();
  for (const { definitionId } of actors)
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
  return counts;
}
