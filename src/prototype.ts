// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
import { createAttackMoveControls } from "./ui/attack-move-controls";
import type { AttackMoveControls } from "./ui/attack-move-controls";
import type { TerrainGrid, TerrainGridOptions } from "./simulation/terrain";
import type { MissionState } from "./simulation/mission";
import type { MissionResult } from "./simulation/objectives";
import {
  createScenarioMap,
  createScenarioState,
  deserializeMission,
} from "./simulation/scenario";
import { disconnectedBuildings } from "./simulation/support";
import { createSupportNetworkView } from "./render/support-network";
import { createFogOverlay, limitToExplored } from "./render/fog";
import { createNetworkControls } from "./ui/network-controls";
import type { NetworkControls } from "./ui/network-controls";
import { ACTOR_REMOVAL_KINDS, isCommandOf } from "./simulation/command";
import { createEconomyControls } from "./ui/economy-controls";
import { createMaterialsSitesView } from "./render/materials-sites";
import { createHarvesterAppearance } from "./render/harvester";
import { createWolfAppearance } from "./render/wolf";
import { createHealthBarView } from "./render/health-bars";
import { createCombatEffectsView } from "./render/combat-effects";
import { createWreckView } from "./render/wrecks";
import { WRECK_SECONDS, wreckTiles } from "./simulation/combat";
import { ECONOMY_ACTOR_DEFINITIONS } from "./content/economy-scenario";
import type { ScenarioDefinition } from "./simulation/scenario";
import { ALPHA_WOLF_SCALE } from "./content/wildlife";
import {
  PROTOTYPE_TERRAIN,
  prototypeWaterDepthAt,
} from "./content/prototype-terrain";
import {
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

import {
  PROTOTYPE_ACTOR_DEFINITIONS,
  PROTOTYPE_ACTOR_NAMES,
  PROTOTYPE_ATTACK_EFFECTS,
  PROTOTYPE_ACTOR_GRAPHICS,
  PROTOTYPE_TILE_PLACED_APPEARANCES,
  PROTOTYPE_MOVEMENT_PROFILES,
} from "./prototype-content";
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
import { OccupancyGrid } from "./simulation/occupancy";
import {
  isMobileActor,
  isTilePlacedActor,
  occupiedTilesFor,
} from "./simulation/placement";
import {
  loadSkinnedActorAppearance,
  validateActorGraphics,
} from "./render/skinned-actor-appearance";
import { startSimulationLoop } from "./simulation/loop";
import { createBuildingPlacement } from "./render/building-placement";
import { createUnitControls } from "./ui/unit-controls";
import type { UnitControls } from "./ui/unit-controls";
import { bindCameraControls } from "./ui/camera-controls";
import { createRallyControls } from "./ui/rally-controls";
import type { RallyControls } from "./ui/rally-controls";
import { createRallyPointView } from "./render/rally-point";
import { createUnitTraining } from "./ui/unit-training";
import type { UnitTrainingControls } from "./ui/unit-training";
import type { DefinitionButton, SidebarState } from "./ui/sidebar";
import type { MissionSimulation } from "./simulation/mission";
import { createTerrainMoveBehavior } from "./simulation/terrain-movement";
import {
  createMissionSimulation,
  createMissionState,
} from "./simulation/mission";

import type { Scene } from "@babylonjs/core";
import type { TerrainTile, TileLayer, TileType } from "./map";
import type { ActorAppearance, GameView, GameViewOptions } from "./render";
import type { ActorRenderState } from "./simulation/actor";
import type { TileCoord } from "./simulation/grid";
import type { BuildingPlacementControls } from "./render/building-placement";
import type { HealthBar } from "./render/health-bars";
import { healthBarOpacity } from "./render/health-bars";
import { createPlayerAccess } from "./simulation/faction";

/** Water opacity at the midline and at the last tile before the bank. */
const WATER_DEEP_ALPHA = 0.98;
const WATER_SHORE_ALPHA = 0.06;
/** Ripple opacity, as a fraction of the water beneath it. */
const WATER_RIPPLE_ALPHA = 0.3;
const SIMULATION_TICK_SECONDS = 1 / 60;
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Covers background-tab throttling to one timer callback per second. */
const MAX_CATCH_UP_SECONDS = 5;
/** How far past explored tile centers the camera may look, in world units. */
const CAMERA_FRONTIER_MARGIN = 4;
/** Health bars sit this far above unit models and over buildings. */
const UNIT_BAR_CLEARANCE = 0.3;
/** Clears a construction progress bar below it. */
const BUILDING_BAR_HEIGHT = 2.9;

export type TerrainPrototype = GameView & {
  simulation: MissionSimulation;
  resume: () => void;
  selectActor: (actorId: string | undefined, additive?: boolean) => void;
  selectActors: (actorIds: readonly string[]) => void;
};

export type TerrainPrototypeControls = BuildingPlacementControls &
  UnitTrainingControls &
  RallyControls &
  NetworkControls &
  UnitControls &
  AttackMoveControls & {
    initialState?: MissionState;
    startPaused?: boolean;
    onResult?: (result: MissionResult) => void;
    buildings?: readonly DefinitionButton[];
    scenario?: ScenarioDefinition;
    economyRoot?: HTMLElement;
    onReady?: (session: TerrainPrototype) => void;
    onDispose?: () => void;
    /** Updates after simulation ticks or changes to controls and selection. */
    onStateChanged?: (state: SidebarState) => void;
    /** Reveals details for an actor the player selected or placed. */
    showActor?: (definitionId: string) => void;
    remove?: HTMLButtonElement;
    animate?: HTMLInputElement;
    cameraControls?: HTMLElement;
  };

/**
 * Water, ripples and clutter are each optional, so every type pins its slot.
 * Minimap colors are each image's mean color and coverage.
 */
export const PROTOTYPE_TILE_TYPES = {
  dirt: {
    id: "dirt",
    slot: 0,
    graphics: {
      url: "/assets/terrain/dirt.png",
      hasAlpha: false,
      minimapColor: [0.472, 0.339, 0.217, 1],
    },
  },
  water: {
    id: "water",
    slot: 1,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      // The image's own alpha caps even the deepest water at about two thirds
      // opaque, so the tile layer owns transparency and can fade to a shore.
      layerAlphaOnly: true,
      scrollSpeed: { u: 0.025, v: 0.012 },
      minimapColor: [0.189, 0.497, 0.557, 1],
    },
  },
  waterRipples: {
    id: "water-ripples",
    slot: 2,
    featherEdges: true,
    graphics: {
      url: "/assets/terrain/water.png",
      hasAlpha: true,
      scale: { u: 1.37, v: 1.37 },
      scrollSpeed: { u: -0.018, v: 0.032 },
      minimapColor: [0.189, 0.497, 0.557, 0.65],
    },
  },
  clutter: {
    id: "clutter",
    slot: 3,
    graphics: {
      url: "/assets/terrain/clutter.png",
      hasAlpha: true,
      minimapColor: [0.409, 0.373, 0.341, 0.05],
    },
  },
} satisfies Record<string, TileType>;

export const PROTOTYPE_VIEW_OPTIONS = {
  clearColor: new Color3(0.035, 0.07, 0.09),
  lighting: {
    skyColor: new Color3(0.6, 0.78, 0.77),
    groundColor: new Color3(0.08, 0.12, 0.1),
    sunColor: Color3.White(),
    sunDirection: new Vector3(-0.5, -1, 0.35),
    skyIntensity: 1.05,
    sunIntensity: 1.3,
  },
} satisfies GameViewOptions;

export function createPrototypeSimulation(
  map: TerrainGrid,
  scenario?: ScenarioDefinition,
  initialState?: MissionState,
): MissionSimulation {
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state:
      initialState ??
      (scenario
        ? createScenarioState(scenario, ECONOMY_ACTOR_DEFINITIONS)
        : createMissionState([])),
    objectives: scenario?.objectives,
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, PROTOTYPE_MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions: scenario
      ? ECONOMY_ACTOR_DEFINITIONS
      : PROTOTYPE_ACTOR_DEFINITIONS,
    tickSeconds: SIMULATION_TICK_SECONDS,
    map,
    occupancy,
  });
  return simulation;
}

/** Parses a mission save, rejecting state the simulation would refuse. */
export function loadMissionSave(
  source: string,
  scenario: ScenarioDefinition,
): MissionState {
  const state = deserializeMission(source, scenario, SIMULATION_TICK_SECONDS);
  createPrototypeSimulation(
    createScenarioMap(scenario),
    scenario,
    state,
  ).dispose();
  return state;
}

export async function createTerrainPrototype(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  controls: TerrainPrototypeControls = {},
): Promise<TerrainPrototype> {
  const scenario = controls.scenario;
  const map = createPrototypeMap(
    scenario && {
      ...scenario,
      terrain: controls.initialState?.terrain ?? scenario.terrain,
    },
  );
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  const definitions = scenario
    ? ECONOMY_ACTOR_DEFINITIONS
    : PROTOTYPE_ACTOR_DEFINITIONS;
  createTerrainMeshes(view.scene, map);
  const simulation = createPrototypeSimulation(
    map,
    scenario,
    controls.initialState,
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const appearances = createPrototypeStandInAppearances(view.scene);
  if (simulation.economy)
    appearances.set(
      "arc-harvester",
      createHarvesterAppearance(view.scene, () => reducedMotion.matches),
    );
  appearances.set(
    "wolf",
    createWolfAppearance(view.scene, () => reducedMotion.matches),
  );
  appearances.set(
    "alpha-wolf",
    createWolfAppearance(
      view.scene,
      () => reducedMotion.matches,
      ALPHA_WOLF_SCALE,
    ),
  );
  const materialsView =
    simulation.economy &&
    createMaterialsSitesView(view.scene, map, simulation.economy);
  const explored = ({ x, z }: TileCoord) =>
    simulation.fog?.isExplored(x, z) ?? true;
  const fogOverlay = createFogOverlay(
    view.scene,
    map,
    PROTOTYPE_VIEW_OPTIONS.clearColor,
  );
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
  const startingActor = scenario && simulation.actors.find(player.owns);
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
    PROTOTYPE_TILE_PLACED_APPEARANCES,
  );
  const networkView = createSupportNetworkView(view.scene, map);
  const disconnected = () => disconnectedBuildings(simulation.support);
  const rallyView = createRallyPointView(view.scene, map);
  const movementPath = createMovementPathView(view.scene, map);
  const healthBars = createHealthBarView(view.scene, map);
  const combatEffects = createCombatEffectsView(view.scene, map);
  const wreckView = createWreckView(view.scene, map, {
    appearanceFor: (id) => appearances.get(id),
    tilesFor: (wreck) =>
      wreckTiles(wreck, definitionsById.get(wreck.definitionId)!),
  });
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
    groundTargetMode: () => rally.active || attackMove.active,
    onGroundTarget: (target) =>
      attackMove.active ? attackMove.choose(target) : rally.choose(target),
    cancelGroundTarget: () => attackMove.cancel() || rally.cancel(),
    canMove: (actorId) => {
      const actor = actorsByKind().byId.get(actorId);
      return (
        !!actor &&
        player.owns(actor) &&
        isMobileActor(actor, definitionsById.get(actor.definitionId))
      );
    },
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
      if (
        command.kind === "move" &&
        simulation.economy?.harvesters.some(
          (worker) => worker.actorId === command.actorId,
        )
      ) {
        const tile = map.tileAtWorldPosition(
          command.target.x,
          command.target.z,
        );
        const site = simulation.economy.sites.find(
          (site) =>
            site.remainingMaterials > 0 &&
            site.tile.x === tile.x &&
            site.tile.z === tile.z &&
            explored(site.tile),
        );
        if (site) {
          simulation.submitCommand({
            kind: "gather",
            actorId: command.actorId,
            siteId: site.id,
          });
          return;
        }
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
    commandMode: () => attackMove.active,
    onCommand: (target) => {
      if (!explored(map.tileAtWorldPosition(target.x, target.z))) return false;
      attackMove.choose(target);
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
          color: [0.3, 0.66, 0.75] as [number, number, number],
        })) ?? []),
      ...(simulation.economy?.loot
        .filter((loot) => !loot.collected && explored(loot.tile))
        .map((loot) => ({
          id: `materials-${loot.id}`,
          worldPosition: map.tileCenter(loot.tile.x, loot.tile.z),
          color: [0.88, 0.65, 0.2] as [number, number, number],
        })) ?? []),
      ...actorsByKind().placed.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        tiles: occupiedTilesFor(
          actor,
          definitionsById.get(actor.definitionId)!,
        ),
        color: PROTOTYPE_TILE_PLACED_APPEARANCES.get(actor.definitionId)
          ?.minimapColor,
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
      placementActive: placement.active,
      faulted: halted(),
      paused: !playing,
      canRemove,
      materials: simulation.economy?.materials,
      objectives: simulation.objectives,
      result: simulation.result,
    });
    knownControlsTick = simulation.completedTicks;
    knownPlacementActive = placement.active;
    controlsDirty = false;
  };
  const placement = createBuildingPlacement(
    canvas,
    view.scene,
    map,
    simulation,
    {
      buildings: definitions
        .filter(
          (definition) =>
            definition.footprint &&
            player.owns({ definitionId: definition.id }),
        )
        .map((definition) => ({
          definition,
          appearance: PROTOTYPE_TILE_PLACED_APPEARANCES.get(definition.id)!,
          name: PROTOTYPE_ACTOR_NAMES.get(definition.id)!,
          build: controls.buildings?.find(
            ({ definitionId }) => definitionId === definition.id,
          )?.button,
        })),
      controls,
      enabled: canCommand,
      onPlaced: (actorId) => {
        input.select(actorId);
        showActor(actorId);
      },
      onStart: () => {
        rally.cancel();
        attackMove.cancel();
        input.setBoxMode(false);
        input.setAdditiveMode(false);
        input.select(undefined);
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
    names: PROTOTYPE_ACTOR_NAMES,
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
    focus: (point) => {
      const tile = map.tileAtWorldPosition(point.x, point.z);
      view.camera.focusOnTile(tile.x, tile.z);
    },
  });
  const economyRoot = controls.economyRoot;
  const economyControls =
    simulation.economy && economyRoot
      ? createEconomyControls(economyRoot, simulation, {
          definitions,
          names: PROTOTYPE_ACTOR_NAMES,
          selectedActorId: selectedOwnActorId,
          canControl: player.owns,
          enabled: () => canCommand() && !placement.active,
          focus: (tile) => view.camera.focusOnTile(tile.x, tile.z),
          explored,
          positionForTile: (tile) => map.tileCenter(tile.x, tile.z),
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
  });
  const disposeCameraControls =
    controls.cameraControls &&
    bindCameraControls(controls.cameraControls, view.camera);
  input.select(undefined);
  if (controls.animate) controls.animate.checked = !reducedMotion.matches;
  let idleSeconds = 0;
  let pickupSeconds = 0;
  let previousFrameTime = performance.now();
  let knownActorVersion = simulation.actorVersion;
  /** Selected actors and those in recent combat show health bars. */
  const updateHealthBars = () => {
    const selected = new Set(input.selectedActorIds);
    const bars: HealthBar[] = [];
    for (const actor of simulation.actors) {
      const maximum = definitionsById.get(actor.definitionId)?.health;
      if (!maximum || !player.shows(actor)) continue;
      const activeTick = actor.combat?.activeTick;
      const opacity = healthBarOpacity(
        selected.has(actor.id),
        activeTick === undefined
          ? Infinity
          : (simulation.completedTicks - activeTick) * simulation.tickSeconds,
      );
      if (opacity === 0) continue;
      const placed = isTilePlacedActor(actor);
      bars.push({
        actorId: actor.id,
        worldPosition: placed
          ? actor.worldPosition
          : (actorViews.groundPosition(actor.id) ?? actor.worldPosition),
        height: placed
          ? BUILDING_BAR_HEIGHT
          : (appearances.get(actor.definitionId)?.bounds.height ?? 1) +
            UNIT_BAR_CLEARANCE,
        width: placed ? 2 : 0.9,
        fraction: (actor.health ?? maximum) / maximum,
        opacity,
      });
    }
    healthBars.update(bars);
  };
  let knownSelectionTick = simulation.completedTicks;

  const cancelInteractions = () => {
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
      const markedTargets = new Set<string>();
      for (const hit of simulation.attacks) {
        const style = PROTOTYPE_ATTACK_EFFECTS.get(hit.attackerDefinitionId);
        if (
          style &&
          (simulation.sees(playerFaction, hit.from) ||
            simulation.sees(playerFaction, hit.to))
        )
          combatEffects.hit(hit, style);
      }
      network.capture();
      minimap.refreshActors();
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
    },
  });
  showMissionResult();
  const renderObserver = view.scene.onBeforeRenderObservable.add(() => {
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
    if (controls.animate?.checked ?? !reducedMotion.matches) {
      idleSeconds += frameSeconds;
    }
    if (!reducedMotion.matches) pickupSeconds += frameSeconds;
    tilePlacedViews.animate(idleSeconds);
    materialsView?.animate(pickupSeconds);
    const { shownMobile } = actorsByKind();
    combatEffects.update(frameSeconds);
    wreckView.update(
      simulation.wrecks,
      (wreck) =>
        (simulation.completedTicks - wreck.tick) * simulation.tickSeconds,
      WRECK_SECONDS,
      (wreck) => player.owns(wreck) || simulation.detects(playerFaction, wreck),
    );
    actorViews.update(
      shownMobile,
      loop.tickProgress(),
      new Set(
        simulation.economy?.harvesters
          .filter((worker) => worker.phase === "gathering")
          .map((worker) => worker.actorId),
      ),
    );
    movementPath.update(shownMobile);
    updateHealthBars();
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
    network.dispose();
    networkView.dispose();
    rallyView.dispose();
    fogOverlay.dispose();
    healthBars.dispose();
    combatEffects.dispose();
    wreckView.dispose();
    economyControls?.dispose();
    materialsView?.dispose();
    controls.onDispose?.();
    view.scene.onBeforeRenderObservable.remove(renderObserver);
    actorViews.dispose();
    tilePlacedViews.dispose();
    movementPath.dispose();
    for (const appearance of appearances.values()) appearance.dispose();
  });

  view.scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset.terrainReady = "true";
    canvas.dataset.actorReady = "true";
    canvas.dataset.tilePlacedActorReady = "true";
    canvas.dataset.tilePlacedActorCount = String(actorsByKind().placed.length);
  });

  const session: TerrainPrototype = {
    ...view,
    simulation,
    resume: () => {
      if (halted()) return;
      playing = true;
      controlsDirty = true;
      loop.resume();
    },
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
  controls.onReady?.(session);
  await Promise.all(
    [...PROTOTYPE_ACTOR_GRAPHICS].map(async ([id, graphics]) => {
      let appearance: ActorAppearance;
      try {
        appearance = await loadSkinnedActorAppearance(view.scene, graphics);
      } catch (error) {
        console.error(`Actor ${id} uses a stand-in model.`, error);
        return;
      }
      if (view.scene.isDisposed) {
        appearance.dispose();
        return;
      }
      const previous = appearances.get(id);
      appearances.set(id, appearance);
      actorViews.update(actorsByKind().shownMobile, loop.tickProgress());
      previous?.dispose();
    }),
  );
  return session;
}

function createPrototypeStandInAppearances(
  scene: Scene,
): Map<string, ActorAppearance> {
  return new Map(
    [...PROTOTYPE_ACTOR_GRAPHICS].map(([id, graphics]) => {
      validateActorGraphics(graphics);
      const { radius, height } = graphics.bounds;
      const mesh = MeshBuilder.CreateBox(
        `actor-template-${id}`,
        { width: radius * 1.4, height, depth: radius * 1.4 },
        scene,
      );
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
        createMeshAppearance(mesh, graphics.bounds, graphics.minimapColor),
      ];
    }),
  );
}

export function createPrototypeMap(scenario?: ScenarioDefinition): TerrainMap {
  const createMap = (options: TerrainGridOptions) =>
    new TerrainMap({ ...options, createLayers: prototypeTileLayers });
  return scenario
    ? createScenarioMap(scenario, createMap)
    : createMap(PROTOTYPE_TERRAIN);
}

/** Layers follow each tile's terrain, so saved terrain keeps its look. */
function prototypeTileLayers(
  x: number,
  z: number,
  { typeId }: Readonly<TerrainTile>,
): TileLayer[] {
  const variation = Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
  // Water beyond the authored pond draws at full depth.
  const depth =
    typeId === "water" ? Math.max(0, prototypeWaterDepthAt(x, z)) || 1 : 0;
  const terrainTint =
    typeId === "path"
      ? [1.08, 0.98, 0.78]
      : typeId === "rough"
        ? [0.68, 0.78, 0.64]
        : [0.86, 0.9, 0.88];
  const layers: TileLayer[] = [
    {
      type: PROTOTYPE_TILE_TYPES.dirt,
      color: new Color4(
        terrainTint[0] + variation,
        terrainTint[1] + variation,
        terrainTint[2] + variation,
        1,
      ),
    },
  ];

  if (depth > 0) {
    const alpha = waterAlpha(depth);
    layers.push({
      type: PROTOTYPE_TILE_TYPES.water,
      color: new Color4(0.74, 0.94, 0.98, alpha),
    });
    layers.push({
      type: PROTOTYPE_TILE_TYPES.waterRipples,
      color: new Color4(0.82, 0.98, 1, alpha * WATER_RIPPLE_ALPHA),
    });
  }

  if (typeId === "rough" || Math.sin(x * 0.47 - z * 0.29) > 0.82) {
    layers.push({
      type: PROTOTYPE_TILE_TYPES.clutter,
      color: new Color4(0.99, 0.66, 0.33, 1),
    });
  }

  return layers;
}

/**
 * Fades the pond towards its banks so its edge reads as a shoreline.
 *
 * @param depth 0 at the bank, 1 at the midline.
 */
function waterAlpha(depth: number): number {
  const eased = depth * depth * (3 - 2 * depth);
  return WATER_SHORE_ALPHA + (WATER_DEEP_ALPHA - WATER_SHORE_ALPHA) * eased;
}
