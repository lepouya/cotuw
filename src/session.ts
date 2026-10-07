// A playable session: the mission's simulation, its views, and its controls.
// Every mission-specific rule and look comes from the mission's content pack.
import { createAttackMoveControls } from "./ui/attack-move-controls";
import type { AttackMoveControls } from "./ui/attack-move-controls";
import type { TerrainGrid, TerrainGridOptions } from "./simulation/terrain";
import type { MissionResult } from "./simulation/objectives";
import { createScenarioMap } from "./simulation/scenario";
import type { ScenarioTerrain } from "./simulation/scenario";
import { parseMission, serializeMission } from "./simulation/mission-file";
import type { MissionFile, SaveInfo } from "./simulation/mission-file";
import { disconnectedBuildings } from "./simulation/support";
import { createSupportNetworkView } from "./render/support-network";
import { createFogOverlay, limitToExplored } from "./render/fog";
import { createNetworkControls } from "./ui/network-controls";
import type { NetworkControls } from "./ui/network-controls";
import { ACTOR_REMOVAL_KINDS, isCommandOf } from "./simulation/command";
import { createEconomyControls } from "./ui/economy-controls";
import { createMaterialsSitesView } from "./render/materials-sites";
import { createHealthBarView } from "./render/health-bars";
import { createCombatEffectsView } from "./render/combat-effects";
import {
  createDamageEffectsView,
  damageSeverity,
} from "./render/damage-effects";
import type { DamagedActor } from "./render/damage-effects";
import { createRegenerationEffectsView } from "./render/regeneration-effects";
import type { RegeneratingActor } from "./render/regeneration-effects";
import { createAmbientBirdsView } from "./render/ambient-birds";
import { createWreckView } from "./render/wrecks";
import {
  createFrameEffectsView,
  withFrameEffects,
} from "./render/frame-effects";
import { WRECK_SECONDS, wreckTiles, weaponReach } from "./simulation/combat";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { contentPack } from "./content/packs";
import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { TerrainMap } from "./map";
import {
  createCommandInput,
  createGameView,
  createMinimap,
  createMovementPathView,
  createActorViewRegistry,
  createTilePlacedActorViewRegistry,
  createMeshAppearance,
  createTerrainMeshes,
  DEFAULT_ACTOR_COLOR,
} from "./render";
import {
  BUILTIN_ACTOR_MODELS,
  BUILTIN_BUILDING_DETAILS,
} from "./render/builtin-models";
import { terrainLayers } from "./render/terrain-style";
import { OccupancyGrid } from "./simulation/occupancy";
import {
  isMobileActor,
  isTilePlacedActor,
  occupiedTilesFor,
} from "./simulation/placement";
import { loadSkinnedActorAppearance } from "./render/skinned-actor-appearance";
import { loadModelAsset, modelBuildingDetails } from "./render/glb-model";
import type { ModelAsset, ModelGraphics } from "./render/glb-model";
import { startSimulationLoop } from "./simulation/loop";
import { createBuildingPlacement } from "./render/building-placement";
import { createUnitControls } from "./ui/unit-controls";
import type { UnitControls } from "./ui/unit-controls";
import { bindCameraControls } from "./ui/camera-controls";
import { createRallyControls } from "./ui/rally-controls";
import type { RallyControls } from "./ui/rally-controls";
import { createRallyPointView } from "./render/rally-point";
import { createQueuedOrderView } from "./render/queued-orders";
import { createUnitTraining } from "./ui/unit-training";
import type { UnitTrainingControls } from "./ui/unit-training";
import type { DefinitionButton, SidebarState } from "./ui/sidebar";
import type { MissionSimulation } from "./simulation/mission";
import type { BuildingActivityKind } from "./simulation/production";
import { createTerrainMoveBehavior } from "./simulation/terrain-movement";
import { createMissionSimulation } from "./simulation/mission";

import type { Scene } from "@babylonjs/core";
import type { ActorAppearance, GameView, GameViewOptions } from "./render";
import type { ActorAnimationState, ActorTrigger } from "./render/actor";
import type { Rgb } from "./render/color";
import type { ActorDefinition, ActorRenderState } from "./simulation/actor";
import type { TileCoord } from "./simulation/grid";
import type { BuildingPlacementControls } from "./render/building-placement";
import type { HealthBar } from "./render/health-bars";
import type { TilePlacedActorAppearance } from "./render/tile-placed-actor-view";
import type { ActorGraphics } from "./render/skinned-actor-appearance";
import type { TerrainStyle } from "./render/terrain-style";
import type { ContentPack, PropId, ViewStyle } from "./content/content-pack";
import { healthBarOpacity } from "./render/health-bars";
import { createPlayerAccess } from "./simulation/faction";
import { createAlertTracker } from "./ui/mission-alerts";
import type { MissionAlert } from "./ui/mission-alerts";
import { duePopup } from "./ui/popups";
import { contextualMoveCommands } from "./ui/contextual-move";
import { createRadialMenu } from "./ui/radial-menu";
import type { ScenarioPopup } from "./simulation/mission-file";
import type { WorldPosition } from "./simulation/world";

const SITE_MINIMAP_COLOR: Rgb = [0.3, 0.66, 0.75];
const SALVAGE_MINIMAP_COLOR: Rgb = [0.88, 0.65, 0.2];
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Bounds each pump's work while retaining longer stalls. */
const MAX_CATCH_UP_SECONDS = 5;
/** How far past explored tile centers the camera may look, in world units. */
const CAMERA_FRONTIER_MARGIN = 4;
/** Health bars sit this far above unit models and over buildings. */
const UNIT_BAR_CLEARANCE = 0.3;
/** Clears a construction progress bar below it. */
const BUILDING_BAR_HEIGHT = 2.9;
/** The trigger a building activity plays on the actor taking part. */
const ACTIVITY_TRIGGERS: Partial<Record<BuildingActivityKind, ActorTrigger>> = {
  delivery: "unload",
};

/** A parsed mission file with the content pack and definitions it uses. */
export type LoadedMission = MissionFile & {
  content: ContentPack;
  definitions: readonly ActorDefinition[];
};

export type GameSession = Omit<GameView, "dispose"> & {
  simulation: MissionSimulation;
  playing: () => boolean;
  /** Pausing ends placement and targeting unless they are kept. */
  pause: (options?: { keepInteractions?: boolean }) => void;
  resume: () => void;
  /** Simulated seconds per real second. */
  speed: () => number;
  setSpeed: (speed: number) => void;
  /** Records a popup's dismissal in the mission state. */
  dismissPopup: (id: string) => void;
  /** Eases the camera to a world point. */
  focus: (point: Readonly<WorldPosition>) => void;
  /** Waits for model and texture initialization before releasing the engine. */
  disposeAsync: () => Promise<void>;
  /** The current mission as a save file. */
  save: (info: SaveInfo) => string;
  selectActor: (actorId: string | undefined, additive?: boolean) => void;
  selectActors: (actorIds: readonly string[]) => void;
};

export type GameSessionControls = BuildingPlacementControls &
  UnitTrainingControls &
  RallyControls &
  NetworkControls &
  UnitControls &
  AttackMoveControls & {
    mission: LoadedMission;
    startPaused?: boolean;
    onResult?: (result: MissionResult) => void;
    buildings?: readonly DefinitionButton[];
    economyRoot?: HTMLElement;
    onReady?: (session: GameSession) => void;
    onDispose?: () => void;
    /** Updates after simulation ticks or changes to controls and selection. */
    onStateChanged?: (state: SidebarState) => void;
    /** Reveals details for an actor the player selected or placed. */
    showActor?: (definitionId: string) => void;
    /** Receives grouped alerts after each tick. */
    onAlerts?: (alerts: readonly MissionAlert[]) => void;
    /** Shows a scenario popup once each time its trigger first holds. */
    onPopup?: (popup: ScenarioPopup) => void;
    remove?: HTMLButtonElement;
    animate?: HTMLInputElement;
    cameraControls?: HTMLElement;
  };

export function createSessionSimulation(
  map: TerrainGrid,
  mission: LoadedMission,
): MissionSimulation {
  const occupancy = new OccupancyGrid(map);
  return createMissionSimulation({
    state: mission.state,
    objectives: mission.scenario.objectives,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(
          map,
          occupancy,
          mission.content.movementProfiles,
        ),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions: mission.definitions,
    tickSeconds: SIMULATION_TICK_SECONDS,
    map,
    occupancy,
  });
}

/** Parses a level or save, rejecting state the simulation would refuse. */
export function loadMission(source: string): LoadedMission {
  const file = parseMission(source, SIMULATION_TICK_SECONDS);
  if (!file.scenario.content)
    throw new RangeError("This mission file names no content pack.");
  const content = contentPack(file.scenario.content);
  const wanted = file.scenario.actors;
  const definitions = wanted
    ? wanted.map((id) => {
        const definition = content.actors.find((actor) => actor.id === id);
        if (!definition)
          throw new RangeError(
            `Content pack ${content.id} has no actor named "${id}".`,
          );
        return definition;
      })
    : content.actors;
  const mission = { ...file, content, definitions };
  const requireActor = (use: string, definitionId: string) => {
    const definition = definitions.find(({ id }) => id === definitionId);
    if (!definition)
      throw new RangeError(
        `Scenario ${use} uses unknown actor "${definitionId}".`,
      );
    return definition;
  };
  for (const goal of file.scenario.goals ?? [])
    requireActor("goal", goal.definitionId);
  for (const { trigger } of file.scenario.popups ?? []) {
    const definition = requireActor("popup", trigger.definitionId);
    if (trigger.kind === "placement" && !definition.footprint)
      throw new RangeError("Placement popups require a building definition.");
  }
  createSessionSimulation(
    createScenarioMap({ ...file.scenario, terrain: file.state.terrain }),
    mission,
  ).dispose();
  return mission;
}

export async function createGameSession(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  controls: GameSessionControls,
): Promise<GameSession> {
  delete canvas.dataset.modelsReady;
  const { mission } = controls;
  const { content, definitions } = mission;
  const map = createSessionMap(
    { ...mission.scenario, terrain: mission.state.terrain },
    content.terrain,
  );
  const options = viewOptions(content.view);
  const view = createGameView(canvas, map, options);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  createTerrainMeshes(view.scene, map, {
    clips: content.clips,
    reducedMotion: () => reducedMotion.matches,
  });
  const simulation = createSessionSimulation(map, mission);
  const presentationOf = (id: string) => content.presentation[id];
  const names = new Map(
    definitions.map(({ id }) => [id, presentationOf(id)?.name ?? id]),
  );
  const buildingAppearances = new Map<string, TilePlacedActorAppearance>(
    definitions.flatMap(({ id }) => {
      const building = presentationOf(id)?.building;
      if (!building) return [];
      const { details, glb: _glb, ...appearance } = building;
      return [
        [
          id,
          {
            ...appearance,
            createDetails: details
              ? BUILTIN_BUILDING_DETAILS[details]
              : undefined,
          },
        ],
      ];
    }),
  );
  const propAssets = new Map<PropId, ModelAsset>();
  /** Every loaded prop and building model, released with the session. */
  const modelAssets: ModelAsset[] = [];
  const models = definitions.flatMap(({ id }) => {
    const model = presentationOf(id)?.model;
    return model ? [[id, model] as const] : [];
  });
  const glbModels = models.flatMap(([id, model]) =>
    "glb" in model ? [[id, model.glb] as const] : [],
  );
  const frameEffects = createFrameEffectsView(
    view.scene,
    content.clips ?? {},
    () => reducedMotion.matches,
  );
  const appearances = new Map<string, ActorAppearance>();
  /** Each appearance also plays its actor's frame effects. */
  const setAppearance = (id: string, appearance: ActorAppearance) => {
    const effects = presentationOf(id)?.frameEffects;
    if (effects) frameEffects.prepare(effects);
    appearances.set(
      id,
      effects
        ? withFrameEffects(appearance, effects, frameEffects)
        : appearance,
    );
  };
  for (const [id, appearance] of standInAppearances(view.scene, glbModels))
    setAppearance(id, appearance);
  for (const [id, model] of models)
    if ("builtin" in model)
      setAppearance(
        id,
        BUILTIN_ACTOR_MODELS[model.builtin](view.scene, {
          scale: model.scale,
          reducedMotion: () => reducedMotion.matches,
        }),
      );
  const materialsView =
    simulation.economy &&
    createMaterialsSitesView(
      view.scene,
      map,
      simulation.economy,
      content.materialsStages,
    );
  const explored = ({ x, z }: TileCoord) =>
    simulation.fog?.isExplored(x, z) ?? true;
  const fogOverlay = createFogOverlay(view.scene, map, options.clearColor);
  const fog = simulation.fog;
  if (fog)
    view.camera.setFocusLimit((point) =>
      limitToExplored(map, fog, point, CAMERA_FRONTIER_MARGIN),
    );
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const playerFaction = simulation.playerFaction;
  const player = createPlayerAccess(
    playerFaction,
    definitionsById,
    simulation.detects,
  );
  const startingActor = simulation.actors.find(player.owns);
  if (startingActor) {
    const { x, z } = startingActor.worldPosition;
    view.camera.focusOnPoint(new Vector3(x, 0, z));
  }
  const actorViews = createActorViewRegistry(
    view.scene,
    map,
    appearances,
    (definitionId) => player.relationTo(definitionId) === "hostile",
  );
  const tilePlacedViews = createTilePlacedActorViewRegistry(
    view.scene,
    map,
    definitions,
    buildingAppearances,
    { reducedMotion: () => reducedMotion.matches },
  );
  const networkView = createSupportNetworkView(view.scene, map);
  const disconnected = () => disconnectedBuildings(simulation.support);
  const rallyView = createRallyPointView(view.scene, map);
  const movementPath = createMovementPathView(view.scene, map);
  const queuedOrders = createQueuedOrderView(view.scene, map, (order) => {
    switch (order.kind) {
      case "move":
      case "attack-move":
        return order.target;
      case "gather": {
        const site = simulation.economy?.sites.find(
          ({ id }) => id === order.siteId,
        );
        return site && map.tileCenter(site.tile.x, site.tile.z);
      }
      case "attack": {
        const target = actorsByKind().byId.get(order.targetId);
        return target && player.shows(target)
          ? target.worldPosition
          : undefined;
      }
    }
  });
  const healthBars = createHealthBarView(view.scene, map);
  const combatEffects = createCombatEffectsView(view.scene, map, (style) =>
    propAssets.get(style),
  );
  const damageEffects = createDamageEffectsView(
    view.scene,
    (prop) => propAssets.get(prop),
    () => reducedMotion.matches,
  );
  const regenerationEffects = createRegenerationEffectsView(
    view.scene,
    () => propAssets.get("regeneration"),
    () => reducedMotion.matches,
  );
  const birds = createAmbientBirdsView(map, mission.scenario.flocks ?? [], {
    bird: () => propAssets.get("bird"),
    explored,
    reducedMotion: () => reducedMotion.matches,
  });
  const buildingModelTops = new Map<string, number>();
  const wreckView = createWreckView(view.scene, map, {
    appearanceFor: (id) => appearances.get(id),
    rubble: () => propAssets.get("rubble"),
    reducedMotion: () => reducedMotion.matches,
    topHeightFor: (wreck) => {
      const drawn = tilePlacedViews.topHeight(wreck.actorId);
      if (drawn !== undefined) return drawn;
      const appearance = buildingAppearances.get(wreck.definitionId);
      if (!appearance || !wreck.tilePlacement) return undefined;
      const tiles = wreckTiles(wreck, definitionsById.get(wreck.definitionId)!);
      const roof = Math.max(
        ...tiles.flatMap(({ x, z }) => [
          map.heightAt(x, z),
          map.heightAt(x + 1, z),
          map.heightAt(x, z + 1),
          map.heightAt(x + 1, z + 1),
        ]),
      );
      return (
        roof +
        appearance.height +
        (buildingModelTops.get(wreck.definitionId) ?? 1) * map.tileSize
      );
    },
    tilesFor: (wreck) =>
      wreckTiles(wreck, definitionsById.get(wreck.definitionId)!),
  });
  const updateWrecks = (seconds: number) =>
    wreckView.update(
      simulation.wrecks,
      (wreck) =>
        (simulation.completedTicks - wreck.tick) * simulation.tickSeconds,
      WRECK_SECONDS,
      (wreck) => player.owns(wreck) || simulation.detects(playerFaction, wreck),
      seconds,
    );
  const partition = (actors: readonly ActorRenderState[]) => {
    const mobile = actors.filter((actor) => !isTilePlacedActor(actor));
    return {
      actors,
      byId: new Map(actors.map((actor) => [actor.id, actor])),
      ownIds: new Set(actors.filter(player.owns).map((actor) => actor.id)),
      mobile,
      placed: actors.filter(isTilePlacedActor).filter(player.shows),
      // Fog changes only when a tick commits, so this stays current.
      shownMobile: mobile.filter(player.shows),
    };
  };
  // Split once per committed tick; the simulation replaces its array each tick.
  let partitioned = partition(simulation.actors);
  const actorsByKind = () => {
    if (partitioned.actors !== simulation.actors) {
      partitioned = partition(simulation.actors);
    }
    return partitioned;
  };
  actorViews.update(actorsByKind().shownMobile, 1);
  tilePlacedViews.update(actorsByKind().placed, disconnected());
  let simulationFaulted = false;
  let playing = !controls.startPaused;
  /** A fault or defeat leaves the session for inspection only. */
  const halted = () =>
    simulationFaulted || simulation.result?.kind === "defeat";
  const canCommand = () => playing && !halted();
  let controlsDirty = true;
  const showActor = (actorId: string) => {
    const actor = simulation.actorById(actorId);
    if (actor) controls.showActor?.(actor.definitionId);
  };
  const radial = createRadialMenu(document.body, canvas);
  const isMobile = (actor: ActorRenderState) =>
    isMobileActor(actor, definitionsById.get(actor.definitionId));
  /** The rendered center of shown actors; undefined once none remain. */
  const cameraPointFor = (ids: readonly string[]) => {
    const points = ids.flatMap((id) => {
      const actor = actorsByKind().byId.get(id);
      if (!actor || !player.shows(actor)) return [];
      return [
        (isMobile(actor) && actorViews.groundPosition(id)) ||
          actor.worldPosition,
      ];
    });
    if (!points.length) return undefined;
    const sum = (axis: "x" | "z") =>
      points.reduce((total, point) => total + point[axis], 0) / points.length;
    return new Vector3(sum("x"), 0, sum("z"));
  };
  const focusActors = (ids: readonly string[]) => {
    const point = cameraPointFor(ids);
    if (point) view.camera.glideToPoint(point);
  };
  const followableIds = (ids: readonly string[]) =>
    ids.filter((id) => {
      const actor = actorsByKind().byId.get(id);
      return !!actor && isMobile(actor);
    });
  const followActors = (ids: readonly string[]) => {
    const tracked = followableIds(ids);
    if (tracked.length) view.camera.follow(() => cameraPointFor(tracked));
  };
  const input = createCommandInput(canvas, view.scene, {
    actorIdForMesh: (mesh) => {
      const id =
        actorViews.actorIdForMesh(mesh) ?? tilePlacedViews.actorIdForMesh(mesh);
      // Committed state, since picking asks about every mesh.
      const actor = id && actorsByKind().byId.get(id);
      return actor && player.shows(actor) ? id : undefined;
    },
    movementTargetForMesh: (mesh) => {
      const tile = materialsView?.lootTileForMesh(mesh);
      return tile && map.tileCenter(tile.x, tile.z);
    },
    actorIdsInRect: (rect) => actorViews.actorIdsInRect(canvas, rect),
    enabled: () => !placement.active && !halted(),
    pointerEnabled: () => !view.camera.primaryPanActive,
    canCommand,
    canSelect: (id) => {
      const actor = actorsByKind().byId.get(id);
      return !!actor && player.shows(actor);
    },
    groundTargetMode: () => rally.active || attackMove.active,
    onGroundTarget: (target, queued) =>
      attackMove.active
        ? attackMove.choose(target, queued)
        : rally.choose(target),
    cancelGroundTarget: () => attackMove.cancel() || rally.cancel(),
    canMove: (actorId) => {
      const actor = actorsByKind().byId.get(actorId);
      return (
        !!actor &&
        player.owns(actor) &&
        isMobileActor(actor, definitionsById.get(actor.definitionId))
      );
    },
    moveLabel: (target) => {
      const tile = map.tileAtWorldPosition(target.x, target.z);
      const at = ({ x, z }: TileCoord) =>
        x === tile.x && z === tile.z && explored(tile);
      const economy = simulation.economy;
      if (economy?.loot.some((loot) => !loot.collected && at(loot.tile)))
        return "Collect";
      const harvesters = new Set(
        economy?.harvesters.map(({ actorId }) => actorId),
      );
      if (
        input.selectedActorIds.some((id) => harvesters.has(id)) &&
        economy?.sites.some(
          (site) => site.remainingMaterials > 0 && at(site.tile),
        )
      )
        return "Gather";
      return undefined;
    },
    onContextMenu: radial.show,
    focusActor: (actorId) => focusActors([actorId]),
    canFollow: (actorId) => followableIds([actorId]).length > 0,
    followActor: (actorId) => followActors([actorId]),
    cancelFocus: view.camera.cancelFocus,
    canAttack: (actorId) => {
      if (!canCommand()) return false;
      const actor = actorsByKind().byId.get(actorId);
      return (
        !!actor &&
        player.relationTo(actor.definitionId) === "hostile" &&
        player.shows(actor)
      );
    },
    submitCommand: (command) => {
      if (!canCommand()) return;
      const economy = simulation.economy;
      if (
        (command.kind === "move" || command.kind === "group-move") &&
        economy
      ) {
        const tile = map.tileAtWorldPosition(
          command.target.x,
          command.target.z,
        );
        const site = economy.sites.find(
          (site) =>
            site.remainingMaterials > 0 &&
            site.tile.x === tile.x &&
            site.tile.z === tile.z &&
            explored(site.tile),
        );
        for (const order of contextualMoveCommands(
          command,
          new Set(economy.harvesters.map(({ actorId }) => actorId)),
          site?.id,
        ))
          simulation.submitCommand(order);
        return;
      }
      simulation.submitCommand(command);
    },
    onWorldSelectionChanged: (ids) => {
      if (ids[0]) showActor(ids[0]);
    },
    onSelectionChanged: (ids) => {
      const actorId = ids.length === 1 ? ids[0] : undefined;
      actorViews.setSelectedActors(ids);
      tilePlacedViews.setSelectedActor(actorId);
      // Other factions' routes would reveal their intent.
      movementPath.setSelectedActors(
        ids.filter((id) => actorsByKind().ownIds.has(id)),
      );
      minimap.refreshActors();
      canvas.dataset.actorSelected = String(ids.length > 0);
      canvas.dataset.selectedActors = JSON.stringify(ids);
      canvas.dataset.selectedActor = actorId ?? "";
      controlsDirty = true;
    },
  });
  const minimap = createMinimap(view.scene, map, view.camera, minimapCanvas, {
    fog: () => simulation.fog,
    reducedMotion: () => reducedMotion.matches,
    commandMode: () => attackMove.active,
    onCommand: (target, shiftKey) => {
      if (!explored(map.tileAtWorldPosition(target.x, target.z))) return false;
      attackMove.choose(target, shiftKey || input.queueMode);
      return true;
    },
    // Structures first, so unit markers draw over them.
    actors: () => [
      ...(simulation.economy?.sites
        .filter((site) => site.remainingMaterials > 0 && explored(site.tile))
        .map((site) => ({
          id: `materials-${site.id}`,
          worldPosition: map.tileCenter(site.tile.x, site.tile.z),
          tiles: [site.tile],
          color: SITE_MINIMAP_COLOR,
        })) ?? []),
      ...(simulation.economy?.loot
        .filter((loot) => !loot.collected && explored(loot.tile))
        .map((loot) => ({
          id: `materials-${loot.id}`,
          worldPosition: map.tileCenter(loot.tile.x, loot.tile.z),
          color: SALVAGE_MINIMAP_COLOR,
        })) ?? []),
      ...actorsByKind().placed.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        tiles: occupiedTilesFor(
          actor,
          definitionsById.get(actor.definitionId)!,
        ),
        color: buildingAppearances.get(actor.definitionId)?.minimapColor,
        selected: input.selectedActorIds.includes(actor.id),
      })),
      ...actorsByKind().shownMobile.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        color: appearances.get(actor.definitionId)?.minimapColor,
        selected: input.selectedActorIds.includes(actor.id),
      })),
    ],
  });
  let pendingRemovalId: string | undefined;
  let knownControlsTick = -1;
  let knownPlacementActive = false;
  const refreshControls = () => {
    const actor = simulation.actors.find(
      ({ id }) => id === input.selectedActorId,
    );
    const canRemove =
      !!actor &&
      player.owns(actor) &&
      isTilePlacedActor(actor) &&
      !pendingRemovalId &&
      canCommand() &&
      !placement.active;
    if (controls.remove) controls.remove.disabled = !canRemove;
    placement.update();
    network.refresh();
    rally.refresh();
    attackMove.refresh();
    training.refresh();
    economyControls?.refresh();
    controls.onStateChanged?.({
      actors: simulation.actors,
      actorVersion: simulation.actorVersion,
      selectedActorIds: input.selectedActorIds,
      boxMode: input.boxMode,
      additiveMode: input.additiveMode,
      queueMode: input.queueMode,
      placementActive: placement.active,
      faulted: halted(),
      paused: !playing,
      following: view.camera.following,
      canRemove,
      materials: simulation.economy?.materials,
      objectives: simulation.objectives,
      result: simulation.result,
    });
    knownControlsTick = simulation.completedTicks;
    knownPlacementActive = placement.active;
    controlsDirty = false;
    raisePopup();
  };
  const popups = mission.scenario.popups ?? [];
  const dismissedPopups = new Set(mission.state.dismissedPopups);
  let raisedPopup: string | undefined;
  const raisePopup = () => {
    if (halted()) return;
    const popup = duePopup(popups, dismissedPopups, {
      placing: placement.definitionId,
      owns: (id) =>
        simulation.actors.some(
          (actor) =>
            actor.definitionId === id &&
            !actor.construction &&
            player.owns(actor),
        ),
    });
    if (!popup || popup.id === raisedPopup) return;
    raisedPopup = popup.id;
    controls.onPopup?.(popup);
  };
  const alertTracker = createAlertTracker({
    owns: player.owns,
    nameOf: (id) => names.get(id) ?? id,
  });
  const observeAlerts = () =>
    alertTracker.observe({
      tick: simulation.completedTicks,
      tickSeconds: simulation.tickSeconds,
      actors: simulation.actors,
      attacks: simulation.attacks,
      wrecks: simulation.wrecks,
      support: simulation.support,
      objectives: simulation.objectives,
      harvesterIds:
        simulation.economy?.harvesters.map(({ actorId }) => actorId) ?? [],
    });
  const placement = createBuildingPlacement(
    canvas,
    view.scene,
    map,
    simulation,
    {
      appearances: buildingAppearances,
      buildings: definitions
        .filter(
          (definition) =>
            definition.footprint &&
            player.owns({ definitionId: definition.id }),
        )
        .map((definition) => ({
          definition,
          name: names.get(definition.id)!,
          build: controls.buildings?.find(
            ({ definitionId }) => definitionId === definition.id,
          )?.button,
        })),
      controls,
      enabled: canCommand,
      pointerEnabled: () => !view.camera.primaryPanActive,
      onPlaced: (actorId) => {
        input.select(actorId);
        showActor(actorId);
      },
      onStart: () => {
        rally.cancel();
        attackMove.cancel();
        input.setBoxMode(false);
        input.setAdditiveMode(false);
        input.setQueueMode(false);
        input.select(undefined);
        raisePopup();
      },
    },
  );
  const removeSelected = () => {
    const actorId = input.selectedActorId;
    const actor = actorId ? simulation.actorById(actorId) : undefined;
    if (
      !actor ||
      !player.owns(actor) ||
      !isTilePlacedActor(actor) ||
      pendingRemovalId !== undefined ||
      !canCommand() ||
      placement.active
    )
      return;
    pendingRemovalId = actor.id;
    simulation.submitCommand({
      kind: actor.construction
        ? "cancel-construction"
        : simulation.economy
          ? "sell-actor"
          : "remove-actor",
      actorId: actor.id,
    });
    controlsDirty = true;
    if (controls.remove) controls.remove.disabled = true;
  };
  controls.remove?.addEventListener("click", removeSelected);
  const selectedOwnActorId = () => {
    const id = input.selectedActorId;
    return id && actorsByKind().ownIds.has(id) ? id : undefined;
  };
  const training = createUnitTraining(simulation, controls, {
    names,
    selectedActorId: selectedOwnActorId,
    enabled: () => canCommand() && !placement.active,
    paused: () => !playing,
  });
  const attackMove = createAttackMoveControls(simulation, controls, {
    selectedMobileIds: () =>
      input.selectedActorIds.filter((id) => {
        const actor = simulation.actors.find((actor) => actor.id === id);
        return (
          !!actor &&
          player.owns(actor) &&
          isMobileActor(actor, definitionsById.get(actor.definitionId))
        );
      }),
    enabled: () => canCommand() && !placement.active,
    changed: () => {
      controlsDirty = true;
    },
    onStart: () => {
      rally.cancel();
      input.setBoxMode(false);
      input.setAdditiveMode(false);
      input.cancelGesture();
    },
  });
  const rally = createRallyControls(simulation, controls, {
    changed: () => {
      controlsDirty = true;
    },
    selectedActorId: selectedOwnActorId,
    isProducer: (id) => !!definitionsById.get(id)?.production,
    enabled: () => canCommand() && !placement.active,
    onStart: () => {
      attackMove.cancel();
      input.setBoxMode(false);
      input.setAdditiveMode(false);
    },
  });
  const network = createNetworkControls(simulation, controls, {
    selectedActorId: selectedOwnActorId,
    canControl: (id) => actorsByKind().ownIds.has(id),
  });
  const economyRoot = controls.economyRoot;
  const economyControls =
    simulation.economy && economyRoot
      ? createEconomyControls(economyRoot, simulation, {
          definitions,
          names,
          selectedActorId: selectedOwnActorId,
          canControl: player.owns,
          enabled: () => canCommand() && !placement.active,
          focus: (tile) => {
            const { x, z } = map.tileCenter(tile.x, tile.z);
            view.camera.glideToPoint(new Vector3(x, 0, z));
          },
          explored,
          positionForTile: (tile) => map.tileCenter(tile.x, tile.z),
          queueMode: () => input.queueMode,
        })
      : undefined;
  view.camera.setTouchPanFilter(
    (event) =>
      !placement.active &&
      !halted() &&
      !input.boxMode &&
      // Rally targeting ignores actors, so drags from them may pan too.
      (rally.active ||
        attackMove.active ||
        input.actorIdAt(event.clientX, event.clientY) === undefined),
  );
  const unitControls = createUnitControls(input, controls, {
    enabled: () => !placement.active && !halted(),
    changed: () => {
      controlsDirty = true;
    },
    focus: () => focusActors(input.selectedActorIds),
    toggleFollow: () => {
      if (view.camera.following) view.camera.cancelFocus();
      else followActors(input.selectedActorIds);
    },
  });
  const disposeCameraControls =
    controls.cameraControls &&
    bindCameraControls(controls.cameraControls, view.camera);
  view.camera.onViewChangedObservable.add(() => {
    controlsDirty = true;
  });
  view.camera.onPanChangedObservable.add(() => {
    input.cancelGesture();
    placement.cancelGesture();
  });
  input.select(undefined);
  if (controls.animate) controls.animate.checked = !reducedMotion.matches;
  const syncAnimationControl = () => {
    const reduced = reducedMotion.matches;
    if (controls.animate && controls.animate.disabled !== reduced)
      controls.animate.disabled = reduced;
  };
  syncAnimationControl();
  let idleSeconds = 0;
  let pickupSeconds = 0;
  let previousFrameTime = performance.now();
  let knownActorVersion = simulation.actorVersion;
  let knownWreckActorVersion = simulation.actorVersion;
  /**
   * Selected actors and those in recent combat show health bars. Damaged and
   * regenerating actors show the effects their presentation names.
   */
  const updateHealth = (frameSeconds: number) => {
    const selected = new Set(input.selectedActorIds);
    const bars: HealthBar[] = [];
    const damaged: DamagedActor[] = [];
    const regenerating: RegeneratingActor[] = [];
    for (const actor of simulation.actors) {
      const maximum = definitionsById.get(actor.definitionId)?.health;
      if (!maximum || !player.shows(actor)) continue;
      const fraction = (actor.health ?? maximum) / maximum;
      const placed = isTilePlacedActor(actor);
      const worldPosition = placed
        ? actor.worldPosition
        : (actorViews.groundPosition(actor.id) ?? actor.worldPosition);
      const bounds = appearances.get(actor.definitionId)?.bounds;
      const activeTick = actor.combat?.activeTick;
      const opacity = healthBarOpacity(
        selected.has(actor.id),
        activeTick === undefined
          ? Infinity
          : (simulation.completedTicks - activeTick) * simulation.tickSeconds,
      );
      if (opacity > 0)
        bars.push({
          actorId: actor.id,
          worldPosition,
          height: placed
            ? BUILDING_BAR_HEIGHT
            : (bounds?.height ?? 1) + UNIT_BAR_CLEARANCE,
          width: placed ? 2 : 0.9,
          fraction,
          opacity,
        });
      const presentation = presentationOf(actor.definitionId);
      const style = presentation?.damageEffect;
      const severity = damageSeverity(fraction);
      const healing =
        presentation?.regenerationEffect &&
        actor.territory?.mode === "regenerating";
      if (!(style && severity) && !healing) continue;
      const { x, z } = worldPosition;
      const ground = map.heightAtWorldPosition(x, z);
      const position = new Vector3(x, ground, z);
      const footprint = definitionsById.get(actor.definitionId)?.footprint;
      const radius = footprint
        ? (Math.sqrt(footprint.occupiedTiles.length) * map.tileSize) / 2
        : (bounds?.radius ?? 0.5);
      if (healing) regenerating.push({ id: actor.id, position, radius });
      if (style && severity)
        damaged.push({
          id: actor.id,
          style,
          severity,
          position,
          height: placed
            ? (tilePlacedViews.topHeight(actor.id) ?? ground + 1) - ground
            : (bounds?.height ?? 1),
          radius,
        });
    }
    healthBars.update(bars);
    damageEffects.update(damaged, frameSeconds);
    regenerationEffects.update(regenerating, frameSeconds);
  };
  /** What a shown mobile actor's appearance reflects from committed state. */
  const animationStateOf = (
    actor: ActorRenderState,
    gathering: ReadonlySet<string>,
  ): ActorAnimationState => {
    const weapon = definitionsById.get(actor.definitionId)?.weapon;
    const targetId = actor.combat?.attack?.targetId;
    const target = targetId && actorsByKind().byId.get(targetId);
    return {
      working: gathering.has(actor.id),
      // Undetected targets stay hidden, so aiming must not reveal them.
      aiming:
        !!weapon &&
        !!target &&
        simulation.detects(playerFaction, target) &&
        weaponReach(actor, target, definitionsById, map) <= weapon.range,
      running: actor.territory?.mode === "pursuing",
    };
  };
  let knownSelectionTick = simulation.completedTicks;

  const cancelInteractions = () => {
    radial.close();
    input.cancelGesture();
    attackMove.cancel();
    rally.cancel();
    placement.cancel();
    controlsDirty = true;
  };
  /** Ends active interactions once the session halts. */
  const haltControls = () => {
    cancelInteractions();
    placement.fault();
    training.fault();
  };
  let shownResult: MissionResult["kind"] | undefined;
  /** Defeat stops the mission; victory pauses it until play continues. */
  const showMissionResult = () => {
    const result = simulation.result;
    if (!result || result.kind === shownResult) return;
    shownResult = result.kind;
    playing = false;
    if (result.kind === "defeat") {
      loop.stop();
      haltControls();
    } else {
      loop.pause();
      cancelInteractions();
    }
    canvas.dataset.missionResult = result.kind;
    controls.onResult?.(result);
  };
  const loop = startSimulationLoop(simulation, {
    paused: controls.startPaused,
    pumpMilliseconds: SIMULATION_PUMP_MILLISECONDS,
    maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    beforeTick: () => actorViews.capturePreviousPoses(actorsByKind().mobile),
    onFault: () => {
      simulationFaulted = true;
      haltControls();
      canvas.dataset.simulationFault = "true";
    },
    afterTick: (outcomes) => {
      // Capture a destroyed building's height before its view leaves.
      if (simulation.actorVersion !== knownWreckActorVersion) {
        updateWrecks(0);
        knownWreckActorVersion = simulation.actorVersion;
      }
      // Completion and activity can share a tick; pose the committed building.
      if (simulation.buildingActivity.length)
        tilePlacedViews.update(actorsByKind().placed, disconnected());
      const markedTargets = new Set<string>();
      for (const hit of simulation.attacks) {
        const style = presentationOf(hit.attackerDefinitionId)?.attackEffect;
        if (
          style &&
          (simulation.sees(playerFaction, hit.from) ||
            simulation.sees(playerFaction, hit.to))
        )
          combatEffects.hit(hit, style);
        const attacker = simulation.actorById(hit.attackerId);
        if (attacker && player.shows(attacker))
          actorViews.play(hit.attackerId, "attack");
        const target = simulation.actorById(hit.targetId);
        if (target && player.shows(target)) actorViews.play(target.id, "hit");
      }
      for (const { buildingId, kind, actorId } of simulation.buildingActivity) {
        const building = simulation.actorById(buildingId);
        if (building && player.shows(building))
          tilePlacedViews.play(buildingId, kind);
        const trigger = ACTIVITY_TRIGGERS[kind];
        const participant = actorId && simulation.actorById(actorId);
        if (trigger && participant && player.shows(participant))
          actorViews.play(participant.id, trigger);
      }
      minimap.refreshActors();
      const alerts = observeAlerts();
      for (const alert of alerts)
        if (alert.pulse && alert.position) minimap.ping(alert.position);
      if (alerts.length) controls.onAlerts?.(alerts);
      const moveStatus = unitControls.onOutcomes(outcomes);
      if (moveStatus) canvas.dataset.moveStatus = moveStatus;
      for (const outcome of outcomes) {
        placement.onOutcome(outcome);
        training.onOutcome(outcome);
        rally.onOutcome(outcome);
        economyControls?.onOutcome(outcome);
        const { command, accepted } = outcome;
        if (command.kind === "train-unit")
          canvas.dataset.trainingStatus = accepted ? "accepted" : "rejected";
        if (command.kind === "attack") {
          canvas.dataset.attackStatus = accepted ? "accepted" : "rejected";
          const target = simulation.actorById(command.targetId);
          if (accepted && target && !markedTargets.has(target.id)) {
            markedTargets.add(target.id);
            combatEffects.markTarget(target.worldPosition);
          }
        }
        if (command.kind === "move" || command.kind === "attack-move") {
          if (accepted)
            canvas.dataset.actorTarget = `${command.target.x},${command.target.z}`;
          else movementPath.showRejectedTarget(command.actorId, command.target);
        }
        const removal = isCommandOf(command, ACTOR_REMOVAL_KINDS);
        if (removal && command.actorId === pendingRemovalId)
          pendingRemovalId = undefined;
        if (removal || command.kind === "place-actor") {
          canvas.dataset.tilePlacedActorCommand = accepted
            ? "accepted"
            : "rejected";
        }
      }
      showMissionResult();
      raisePopup();
    },
  });
  showMissionResult();
  // Loading a mission records its state without raising alerts.
  observeAlerts();
  // Weighted clip seeks must precede Babylon's animation evaluation.
  const renderObserver = view.scene.onBeforeAnimationsObservable.add(() => {
    // Polled rather than evented: the query can change before its event fires.
    syncAnimationControl();
    loop.advance();
    // Hostiles can leave vision without any fog change, so check every tick.
    if (
      simulation.actorVersion !== knownActorVersion ||
      simulation.completedTicks !== knownSelectionTick
    ) {
      knownSelectionTick = simulation.completedTicks;
      const actors = new Map(
        simulation.actors.map((actor) => [actor.id, actor]),
      );
      input.retainSelection((id) => {
        const actor = actors.get(id);
        return !!actor && player.shows(actor);
      });
    }
    if (simulation.actorVersion !== knownActorVersion) {
      knownActorVersion = simulation.actorVersion;
      controlsDirty = true;
      const { placed } = actorsByKind();
      tilePlacedViews.update(placed, disconnected());
      canvas.dataset.tilePlacedActorCount = String(placed.length);
      minimap.refreshActors();
    }
    if (placement.active) placement.update();
    fogOverlay.update(simulation.fog);
    if (simulation.fog)
      canvas.dataset.exploredTiles = String(simulation.fog.exploredCount);
    if (simulation.economy) {
      materialsView?.update(simulation.economy, explored);
      if (simulation.completedTicks !== knownControlsTick)
        tilePlacedViews.update(actorsByKind().placed, disconnected());
    }
    if (
      controlsDirty ||
      simulation.completedTicks !== knownControlsTick ||
      placement.active !== knownPlacementActive
    )
      refreshControls();
    const frameTime = performance.now();
    const frameSeconds = (frameTime - previousFrameTime) / 1000;
    previousFrameTime = frameTime;
    if (!reducedMotion.matches && (controls.animate?.checked ?? true)) {
      idleSeconds += frameSeconds;
    }
    if (!reducedMotion.matches) pickupSeconds += frameSeconds;
    tilePlacedViews.animate(idleSeconds, frameSeconds);
    materialsView?.animate(pickupSeconds);
    const { shownMobile } = actorsByKind();
    combatEffects.update(frameSeconds);
    frameEffects.update(frameSeconds);
    updateWrecks(frameSeconds);
    birds.update(frameSeconds);
    const gathering = new Set(
      simulation.economy?.harvesters
        .filter((worker) => worker.phase === "gathering")
        .map((worker) => worker.actorId),
    );
    actorViews.update(shownMobile, loop.tickProgress(), frameSeconds, (actor) =>
      animationStateOf(actor, gathering),
    );
    movementPath.update(shownMobile);
    // Other factions' queues would reveal their intent.
    queuedOrders.update(
      input.selectedActorIds.flatMap((id) => {
        const actor = actorsByKind().byId.get(id);
        return actor && player.owns(actor) ? [actor] : [];
      }),
    );
    updateHealth(frameSeconds);
    const ownIds = actorsByKind().ownIds;
    networkView.update(
      simulation.support && {
        nodes: simulation.support.nodes.filter((node) =>
          ownIds.has(node.actorId),
        ),
        links: simulation.support.links.filter((link) =>
          [link.from, link.to].every((id) => ownIds.has(id)),
        ),
      },
      placement.active ||
        network.visible ||
        !!simulation.support?.nodes.some(
          (node) => node.actorId === input.selectedActorId,
        ),
    );
    rallyView.update(
      simulation.actors.find((actor) => actor.id === selectedOwnActorId())
        ?.rallyPoint,
    );
  });
  view.scene.onDisposeObservable.add(() => {
    loop.stop();
    simulation.dispose();
    input.dispose();
    unitControls.dispose();
    disposeCameraControls?.();
    placement.dispose();
    controls.remove?.removeEventListener("click", removeSelected);
    training.dispose();
    rally.dispose();
    attackMove.dispose();
    radial.dispose();
    networkView.dispose();
    rallyView.dispose();
    fogOverlay.dispose();
    healthBars.dispose();
    combatEffects.dispose();
    damageEffects.dispose();
    regenerationEffects.dispose();
    birds.dispose();
    frameEffects.dispose();
    wreckView.dispose();
    economyControls?.dispose();
    materialsView?.dispose();
    controls.onDispose?.();
    view.scene.onBeforeAnimationsObservable.remove(renderObserver);
    actorViews.dispose();
    tilePlacedViews.dispose();
    movementPath.dispose();
    queuedOrders.dispose();
    for (const appearance of appearances.values()) appearance.dispose();
    for (const asset of modelAssets) asset.dispose();
  });

  view.scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset.terrainReady = "true";
    canvas.dataset.actorReady = "true";
    canvas.dataset.tilePlacedActorReady = "true";
    canvas.dataset.tilePlacedActorCount = String(actorsByKind().placed.length);
  });

  let disposal: Promise<void> | undefined;
  const { dispose: disposeView, ...sessionView } = view;
  const session: GameSession = {
    ...sessionView,
    simulation,
    disposeAsync: () =>
      (disposal ??= (async () => {
        session.pause();
        try {
          await modelsReady;
          // Babylon's BRDF decode outlives the model load and uses the engine.
          while (
            !view.scene.isDisposed &&
            view.scene.environmentBRDFTexture &&
            !view.scene.environmentBRDFTexture.loadingError &&
            !view.scene.environmentBRDFTexture.isReady()
          )
            await new Promise((resolve) => setTimeout(resolve, 16));
        } finally {
          if (!view.scene.isDisposed) disposeView();
        }
      })()),
    playing: () => playing,
    pause: ({ keepInteractions = false } = {}) => {
      if (keepInteractions) radial.close();
      else cancelInteractions();
      if (!playing) return;
      playing = false;
      controlsDirty = true;
      loop.pause();
    },
    resume: () => {
      if (halted() || disposal) return;
      if (playing) return;
      // Paused rendering settles to committed poses; resume must not rewind.
      actorViews.capturePreviousPoses(actorsByKind().mobile);
      playing = true;
      controlsDirty = true;
      loop.resume();
    },
    speed: () => loop.speed,
    setSpeed: (speed) => {
      loop.setSpeed(speed);
      controlsDirty = true;
    },
    dismissPopup: (id) => {
      dismissedPopups.add(id);
      controlsDirty = true;
    },
    focus: (point) =>
      view.camera.glideToPoint(new Vector3(point.x, 0, point.z)),
    save: (info) =>
      serializeMission(
        mission.scenario,
        {
          ...simulation.snapshot(),
          dismissedPopups: dismissedPopups.size
            ? [...dismissedPopups]
            : undefined,
        },
        SIMULATION_TICK_SECONDS,
        info,
      ),
    selectActor: (actorId, additive = false) => {
      if (simulationFaulted || placement.active) return;
      const actor = actorId && simulation.actorById(actorId);
      input.select(
        actor && player.shows(actor) ? actorId : undefined,
        additive || input.additiveMode,
      );
    },
    selectActors: (ids) => {
      if (simulationFaulted || placement.active) return;
      input.selectMany(
        ids.filter((id) => {
          const actor = simulation.actorById(id);
          return !!actor && player.shows(actor);
        }),
      );
    },
  };
  /** Updates building appearances, then rebuilds the views that use them. */
  const setBuildings = (
    ids: Iterable<string>,
    change: Partial<TilePlacedActorAppearance>,
  ) => {
    for (const id of ids)
      buildingAppearances.set(id, {
        ...buildingAppearances.get(id)!,
        ...change,
      });
    tilePlacedViews.update(actorsByKind().placed, disconnected());
  };
  /** Props whose views swap stand-ins as they load; others are looked up. */
  const propLoaded: Partial<Record<PropId, (asset: ModelAsset) => void>> = {
    foundation: (asset) =>
      setBuildings([...buildingAppearances.keys()], { foundation: asset }),
    scaffold: (asset) =>
      setBuildings([...buildingAppearances.keys()], { scaffold: asset }),
    "materials-mound": (asset) => materialsView?.setMound(asset),
    salvage: (asset) => materialsView?.setSalvage(asset),
  };
  /** Loaded assets arrive only while the scene lives; failures keep stand-ins. */
  const loadAsset = async <T extends { dispose: () => void }>(
    label: string,
    load: () => Promise<T>,
    use: (asset: T) => void,
  ) => {
    try {
      const asset = await load();
      if (view.scene.isDisposed) asset.dispose();
      else use(asset);
    } catch (error) {
      if (!view.scene.isDisposed)
        console.error(`${label} failed to load and keeps its stand-in.`, error);
    }
  };
  const loadModel = (
    label: string,
    graphics: ModelGraphics,
    use: (asset: ModelAsset) => void,
  ) =>
    loadAsset(
      label,
      () => loadModelAsset(view.scene, graphics),
      (asset) => {
        modelAssets.push(asset);
        use(asset);
      },
    );
  const modelsReady = Promise.all([
    ...(Object.entries(content.props ?? {}) as [PropId, ModelGraphics][]).map(
      ([id, graphics]) =>
        loadModel(`Prop ${id}`, graphics, (asset) => {
          propAssets.set(id, asset);
          propLoaded[id]?.(asset);
        }),
    ),
    ...definitions.flatMap(({ id }) => {
      const graphics = presentationOf(id)?.building?.glb;
      return graphics
        ? [
            loadModel(`Building ${id}`, graphics, (asset) => {
              if (asset.topHeight !== undefined)
                buildingModelTops.set(id, asset.topHeight);
              setBuildings([id], {
                createDetails: modelBuildingDetails(asset),
              });
            }),
          ]
        : [];
    }),
    ...glbModels.map(([id, graphics]) =>
      loadAsset(
        `Actor ${id}`,
        () =>
          loadSkinnedActorAppearance(view.scene, graphics, {
            reducedMotion: () => reducedMotion.matches,
          }),
        (appearance) => {
          const previous = appearances.get(id);
          setAppearance(id, appearance);
          actorViews.update(actorsByKind().shownMobile, loop.tickProgress());
          updateWrecks(0);
          previous?.dispose();
        },
      ),
    ),
  ]).then(() => {
    if (!view.scene.isDisposed) canvas.dataset.modelsReady = "true";
  });
  controls.onReady?.(session);
  return session;
}

/** Boxes in each model's color stand in while its GLB loads. */
function standInAppearances(
  scene: Scene,
  models: readonly (readonly [string, ActorGraphics])[],
): Map<string, ActorAppearance> {
  return new Map(
    models.map(([id, graphics]) => {
      const { radius, height } = graphics.bounds;
      const mesh = MeshBuilder.CreateBox(
        `actor-template-${id}`,
        { width: radius * 1.4, height, depth: radius * 1.4 },
        scene,
      );
      const root = new TransformNode(`actor-template-${id}-root`, scene);
      mesh.parent = root;
      mesh.position.y = height / 2;
      const material = new StandardMaterial(
        `actor-template-${id}-material`,
        scene,
      );
      material.diffuseColor = new Color3(
        ...(graphics.minimapColor ?? DEFAULT_ACTOR_COLOR),
      );
      material.specularColor = new Color3(0.12, 0.12, 0.12);
      mesh.material = material;
      return [
        id,
        createMeshAppearance(root, graphics.bounds, graphics.minimapColor),
      ];
    }),
  );
}

export function createSessionMap(
  scenario: ScenarioTerrain,
  style: TerrainStyle,
): TerrainMap {
  const createLayers = terrainLayers(style);
  return createScenarioMap(
    scenario,
    (options: TerrainGridOptions) =>
      new TerrainMap({
        ...options,
        createLayers,
        layerUpdateRadius: style.shore?.depthTiles,
      }),
  );
}

function viewOptions({ clearColor, lighting }: ViewStyle): GameViewOptions {
  return {
    clearColor: new Color3(...clearColor),
    lighting: {
      ...lighting,
      skyColor: new Color3(...lighting.skyColor),
      groundColor: new Color3(...lighting.groundColor),
      sunColor: new Color3(...lighting.sunColor),
      sunDirection: new Vector3(...lighting.sunDirection),
    },
  };
}
