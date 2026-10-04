/** How combat destruction of an objective's actors resolves it. */
export type ObjectiveKind = "destroy" | "protect";

export type ObjectiveDefinition = {
  readonly id: string;
  readonly kind: ObjectiveKind;
  readonly label: string;
  readonly directive: string;
  readonly actorIds: readonly string[];
};

export type ObjectiveState = {
  id: string;
  kind: ObjectiveKind;
  actorIds: string[];
  /** Targets destroyed in combat; removal and sale do not count. */
  destroyedActorIds: string[];
  /** The tick the objective completed or failed. */
  resolvedTick?: number;
};

export type ObjectiveStatus = "active" | "complete" | "failed";

export type ObjectiveView = {
  id: string;
  label: string;
  directive: string;
  status: ObjectiveStatus;
  /** Destroyed and total targets, for objectives that victory requires. */
  progress?: { current: number; total: number };
};

export type MissionResult =
  | { kind: "victory"; tick: number }
  | { kind: "defeat"; objectiveId: string; tick: number };

type ObjectiveRule = {
  /** Whether victory requires this objective to complete. */
  goal: boolean;
  status: (destroyed: number, total: number) => ObjectiveStatus;
};

const RULES: Record<ObjectiveKind, ObjectiveRule> = {
  destroy: {
    goal: true,
    status: (destroyed, total) => (destroyed === total ? "complete" : "active"),
  },
  protect: {
    goal: false,
    status: (destroyed) => (destroyed > 0 ? "failed" : "active"),
  },
};

const statusOf = (
  objective: ObjectiveDefinition,
  state: ObjectiveState,
): ObjectiveStatus =>
  RULES[objective.kind].status(
    state.destroyedActorIds.length,
    objective.actorIds.length,
  );

export function createObjectiveStates(
  objectives: readonly ObjectiveDefinition[],
): ObjectiveState[] {
  return objectives.map(({ id, kind, actorIds }) => ({
    id,
    kind,
    actorIds: [...actorIds],
    destroyedActorIds: [],
  }));
}

/** Projects committed progress into presentation and the mission verdict. */
export function evaluateObjectives(
  objectives: readonly ObjectiveDefinition[],
  states: readonly ObjectiveState[],
): { views: ObjectiveView[]; result?: MissionResult } {
  const statesById = new Map(states.map((state) => [state.id, state]));
  let failure: Extract<MissionResult, { kind: "defeat" }> | undefined;
  let goals = 0;
  let completed = 0;
  let victoryTick = 0;
  const views = objectives.map((objective): ObjectiveView => {
    const state = statesById.get(objective.id)!;
    const status = statusOf(objective, state);
    const goal = RULES[objective.kind].goal;
    if (
      status === "failed" &&
      (!failure ||
        state.resolvedTick! < failure.tick ||
        (state.resolvedTick === failure.tick &&
          objective.id < failure.objectiveId))
    )
      failure = {
        kind: "defeat",
        objectiveId: objective.id,
        tick: state.resolvedTick!,
      };
    if (goal) {
      goals++;
      if (status === "complete") {
        completed++;
        victoryTick = Math.max(victoryTick, state.resolvedTick!);
      }
    }
    return {
      id: objective.id,
      label: objective.label,
      directive: objective.directive,
      status,
      ...(goal && {
        progress: {
          current: state.destroyedActorIds.length,
          total: objective.actorIds.length,
        },
      }),
    };
  });
  return {
    views,
    result:
      failure ??
      (goals > 0 && completed === goals
        ? { kind: "victory", tick: victoryTick }
        : undefined),
  };
}

export function validateObjectives(
  objectives: readonly ObjectiveDefinition[],
  states: readonly ObjectiveState[],
  actorIds: ReadonlySet<string>,
  retiredIds: ReadonlySet<string>,
  tick: number,
): void {
  const ids = new Set<string>();
  if (
    !Array.isArray(states) ||
    states.length !== objectives.length ||
    states.some((state) => !state) ||
    new Set(states.map(({ id }) => id)).size !== states.length
  )
    throw new RangeError("Mission state has incompatible objectives.");
  const statesById = new Map(states.map((state) => [state.id, state]));
  for (const objective of objectives) {
    if (
      !objective ||
      typeof objective.id !== "string" ||
      !objective.id ||
      ids.has(objective.id) ||
      !Object.keys(RULES).includes(objective.kind) ||
      typeof objective.label !== "string" ||
      !objective.label ||
      typeof objective.directive !== "string" ||
      !objective.directive ||
      !Array.isArray(objective.actorIds)
    )
      throw new RangeError("Mission has an invalid objective definition.");
    const targets = new Set(objective.actorIds);
    if (
      targets.size === 0 ||
      targets.size !== objective.actorIds.length ||
      [...targets].some(
        (id) =>
          typeof id !== "string" ||
          !id ||
          (!actorIds.has(id) && !retiredIds.has(id)),
      )
    )
      throw new RangeError("Mission has an invalid objective definition.");
    ids.add(objective.id);
    const state = statesById.get(objective.id);
    if (
      !state ||
      state.kind !== objective.kind ||
      !Array.isArray(state.actorIds) ||
      state.actorIds.length !== targets.size ||
      new Set(state.actorIds).size !== targets.size ||
      state.actorIds.some((id: string) => !targets.has(id))
    )
      throw new RangeError("Mission state has incompatible objective content.");
    if (
      !Array.isArray(state.destroyedActorIds) ||
      new Set(state.destroyedActorIds).size !==
        state.destroyedActorIds.length ||
      state.destroyedActorIds.some(
        (id: string) =>
          !targets.has(id) || !retiredIds.has(id) || actorIds.has(id),
      ) ||
      (state.resolvedTick !== undefined &&
        (!Number.isSafeInteger(state.resolvedTick) ||
          state.resolvedTick < 0 ||
          state.resolvedTick >= tick)) ||
      (state.resolvedTick !== undefined) !==
        (statusOf(objective, state) !== "active")
    )
      throw new RangeError("Mission state has invalid objective progress.");
  }
}

export function recordObjectiveDestruction(
  objectives: readonly ObjectiveDefinition[],
  states: ObjectiveState[],
  actorId: string,
  tick: number,
): void {
  const statesById = new Map(states.map((state) => [state.id, state]));
  for (const objective of objectives) {
    const state = statesById.get(objective.id)!;
    if (
      !objective.actorIds.includes(actorId) ||
      state.destroyedActorIds.includes(actorId)
    )
      continue;
    state.destroyedActorIds.push(actorId);
    if (
      state.resolvedTick === undefined &&
      statusOf(objective, state) !== "active"
    )
      state.resolvedTick = tick;
  }
}
