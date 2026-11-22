import { DEFAULT_KEYBOARD } from "./keyboard-preferences";
import type { KeyboardBindings } from "./keyboard-preferences";
import { missionEnded } from "../simulation/mission-result";
import type { ActorDefinition, ActorRenderState } from "../simulation/actor";
import type { ObservedActor } from "../simulation/owner-view";
import type { Resource } from "../simulation/resources";
import type { OwnerRelation } from "../simulation/ownership";
import type { MissionResult } from "../simulation/mission-result";
import type { ObjectiveView } from "../simulation/objectives";
import type {
  ScenarioBriefing,
  ScenarioGoal,
} from "../simulation/mission-file";
import type { ActorPresentation } from "../content/presentation";
import type { UnitTypeScope } from "../render/selection";

import type { SiteSelection } from "./cultivation-feedback";

export type SidebarState = {
  /** Own and currently detected actors only. */
  actors: readonly ObservedActor[];
  ownActors?: readonly ActorRenderState[];
  actorVersion: number;
  selectedActorIds: readonly string[];
  selectedSite?: SiteSelection;
  boxMode?: boolean;
  additiveMode?: boolean;
  queueMode?: boolean;
  placementActive: boolean;
  faulted: boolean;
  paused?: boolean;
  /** Whether the camera follows actors. */
  following?: boolean;
  /** Present when the mission has an economy. */
  balances?: Partial<Record<Resource, number>>;
  objectives?: readonly ObjectiveView[];
  result?: MissionResult;
  relationTo: (actor: Pick<ObservedActor, "owner">) => OwnerRelation;
};

export type SidebarOptions = {
  definitions: readonly ActorDefinition[];
  keyboard?: KeyboardBindings;
  economy?: boolean;
  presentations: ReadonlyMap<string, ActorPresentation>;
  goals: readonly ScenarioGoal[];
  briefing?: ScenarioBriefing;
  selectActor: (id: string, additive?: boolean) => void;
  /** Selects the player's units of a type in view or across the map. */
  selectType?: (definitionId: string, scope: UnitTypeScope) => void;
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
  const list = new Intl.ListFormat("en", { type: "conjunction" });
  return {
    ...options,
    keyboard: options.keyboard ?? DEFAULT_KEYBOARD,
    root,
    signal,
    definitionById: new Map(
      options.definitions.map((definition) => [definition.id, definition]),
    ),
    nameFor,
    /** A producer's trainable units as one readable list. */
    trainedNames: (definition: ActorDefinition) =>
      list.format(definition.production!.unitDefinitionIds.map(nameFor)),
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
