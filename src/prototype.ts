import { createScenarioState } from "./simulation/scenario";
import { createEconomyControls } from "./ui/economy-controls";
import { createMaterialsSitesView } from "./render/materials-sites";
import { createHarvesterAppearance } from "./render/harvester";
import { ARC_ACTOR_DEFINITIONS } from "./content/arc";
import type { ScenarioDefinition } from "./simulation/scenario";
import type { MissionState } from "./simulation/mission";
import {
  PROTOTYPE_MAP_SIZE,
  WATER_HALF_WIDTH,
  WATER_CENTER,
  prototypeTerrainAt,
  prototypeHeightAt,
} from "./content/prototype-terrain";
// Throwaway prototype code: a sample map and the scene that shows it.
// Replace this with real game setup once the prototype has served its purpose.
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
import type { TileLayer, TileType } from "./map";
import type { ActorAppearance, GameView, GameViewOptions } from "./render";
import type { ActorRenderState } from "./simulation/actor";
import type { BuildingPlacementControls } from "./render/building-placement";

const TILE_COUNT = PROTOTYPE_MAP_SIZE;
const TILE_SIZE = 1;
/** Water opacity at the midline and at the last tile before the bank. */
const WATER_DEEP_ALPHA = 0.98;
const WATER_SHORE_ALPHA = 0.06;
/** Ripple opacity, as a fraction of the water beneath it. */
const WATER_RIPPLE_ALPHA = 0.3;
const SIMULATION_TICK_SECONDS = 1 / 60;
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Covers background-tab throttling to one timer callback per second. */
const MAX_CATCH_UP_SECONDS = 5;

export type TerrainPrototype = GameView & {
  simulation: MissionSimulation;
  selectActor: (actorId: string | undefined, additive?: boolean) => void;
  selectActors: (actorIds: readonly string[]) => void;
};

export type TerrainPrototypeControls = BuildingPlacementControls &
  UnitTrainingControls &
  UnitControls & {
    buildings?: readonly DefinitionButton[];
    scenario?: ScenarioDefinition;
    economyRoot?: HTMLElement;
    state?: MissionState;
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

export async function createTerrainPrototype(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  controls: TerrainPrototypeControls = {},
): Promise<TerrainPrototype> {
  const map = createPrototypeMap();
  const view = createGameView(canvas, map, PROTOTYPE_VIEW_OPTIONS);

  const definitions = controls.scenario
    ? ARC_ACTOR_DEFINITIONS
    : PROTOTYPE_ACTOR_DEFINITIONS;
  createTerrainMeshes(view.scene, map);
  const occupancy = new OccupancyGrid(map);
  const simulation = createMissionSimulation({
    state:
      controls.state ??
      (controls.scenario
        ? createScenarioState(controls.scenario, definitions)
        : createMissionState([])),
    behaviorRegistry: new Map([
      [
        "terrain-move",
        createTerrainMoveBehavior(map, occupancy, PROTOTYPE_MOVEMENT_PROFILES),
      ],
      ["idle", { handleCommand: () => false, update: () => {} }],
    ]),
    bounds: map.worldBounds,
    definitions,
    tickSeconds: SIMULATION_TICK_SECONDS,
    map,
    occupancy,
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const appearances = createPrototypeStandInAppearances(view.scene);
  if (simulation.economy)
    appearances.set(
      "arc-harvester",
      createHarvesterAppearance(view.scene, () => reducedMotion.matches),
    );
  const materialsView =
    simulation.economy &&
    createMaterialsSitesView(view.scene, map, simulation.economy);
  if (controls.scenario) view.camera.focusOnTile(15, 50);
  const actorViews = createActorViewRegistry(view.scene, map, appearances);
  const tilePlacedViews = createTilePlacedActorViewRegistry(
    view.scene,
    map,
    definitions,
    PROTOTYPE_TILE_PLACED_APPEARANCES,
  );
  const movementPath = createMovementPathView(view.scene, map);
  const partition = (actors: readonly ActorRenderState[]) => ({
    actors,
    mobile: actors.filter((actor) => !isTilePlacedActor(actor)),
    placed: actors.filter(isTilePlacedActor),
  });
  // Split once per committed tick; the simulation replaces its array each tick.
  let partitioned = partition(simulation.actors);
  const actorsByKind = () => {
    if (partitioned.actors !== simulation.actors) {
      partitioned = partition(simulation.actors);
    }
    return partitioned;
  };
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  actorViews.update(actorsByKind().mobile, 1);
  tilePlacedViews.update(actorsByKind().placed);
  let simulationFaulted = false;
  let controlsDirty = true;
  const showActor = (actorId: string) => {
    const actor = simulation.actorById(actorId);
    if (actor) controls.showActor?.(actor.definitionId);
  };
  const input = createCommandInput(canvas, view.scene, {
    actorIdForMesh: (mesh) =>
      actorViews.actorIdForMesh(mesh) ?? tilePlacedViews.actorIdForMesh(mesh),
    actorIdsInRect: (rect) => actorViews.actorIdsInRect(canvas, rect),
    enabled: () => !placement.active && !simulationFaulted,
    canMove: (actorId) => {
      const actor = simulation.actorById(actorId);
      return (
        !!actor && isMobileActor(actor, definitionsById.get(actor.definitionId))
      );
    },
    submitCommand: (command) => {
      if (simulationFaulted) return;
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
          (site) => site.tile.x === tile.x && site.tile.z === tile.z,
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
      movementPath.setSelectedActors(ids);
      minimap.refreshActors();
      canvas.dataset.actorSelected = String(ids.length > 0);
      canvas.dataset.selectedActors = JSON.stringify(ids);
      canvas.dataset.selectedActor = actorId ?? "";
      controlsDirty = true;
    },
  });
  const minimap = createMinimap(view.scene, map, view.camera, minimapCanvas, {
    // Structures first, so unit markers draw over them.
    actors: () => [
      ...(simulation.economy?.sites
        .filter((site) => site.remainingMaterials > 0)
        .map((site) => ({
          id: `materials-${site.id}`,
          worldPosition: map.tileCenter(site.tile.x, site.tile.z),
          tiles: [site.tile],
          color: [0.3, 0.66, 0.75] as [number, number, number],
        })) ?? []),
      ...(simulation.economy?.loot
        .filter((loot) => !loot.collected)
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
      ...actorsByKind().mobile.map((actor) => ({
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
      isTilePlacedActor(actor) &&
      !pendingRemovalId &&
      !simulationFaulted &&
      !placement.active;
    if (controls.remove) controls.remove.disabled = !canRemove;
    training.refresh();
    economyControls?.refresh();
    controls.onStateChanged?.({
      actors: simulation.actors,
      actorVersion: simulation.actorVersion,
      selectedActorIds: input.selectedActorIds,
      boxMode: input.boxMode,
      additiveMode: input.additiveMode,
      placementActive: placement.active,
      faulted: simulationFaulted,
      canRemove,
      materials: simulation.economy?.materials,
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
        .filter((definition) => definition.footprint)
        .map((definition) => ({
          definition,
          appearance: PROTOTYPE_TILE_PLACED_APPEARANCES.get(definition.id)!,
          name: PROTOTYPE_ACTOR_NAMES.get(definition.id)!,
          build: controls.buildings?.find(
            ({ definitionId }) => definitionId === definition.id,
          )?.button,
        })),
      controls,
      onPlaced: (actorId) => {
        input.select(actorId);
        showActor(actorId);
      },
      onStart: () => {
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
      !isTilePlacedActor(actor) ||
      pendingRemovalId !== undefined ||
      simulationFaulted ||
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
  const training = createUnitTraining(simulation, controls, {
    names: PROTOTYPE_ACTOR_NAMES,
    selectedActorId: () => input.selectedActorId,
    enabled: () => !simulationFaulted && !placement.active,
  });
  const economyRoot = controls.economyRoot;
  const economyControls =
    simulation.economy && economyRoot
      ? createEconomyControls(economyRoot, simulation, {
          definitions,
          names: PROTOTYPE_ACTOR_NAMES,
          selectedActorId: () => input.selectedActorId,
          enabled: () => !simulationFaulted && !placement.active,
          focus: (tile) => view.camera.focusOnTile(tile.x, tile.z),
          positionForTile: (tile) => map.tileCenter(tile.x, tile.z),
        })
      : undefined;
  view.camera.setTouchPanFilter(
    (event) =>
      !placement.active &&
      !simulationFaulted &&
      !input.boxMode &&
      input.actorIdAt(event.clientX, event.clientY) === undefined,
  );
  const unitControls = createUnitControls(input, controls, {
    enabled: () => !placement.active && !simulationFaulted,
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

  const loop = startSimulationLoop(simulation, {
    pumpMilliseconds: SIMULATION_PUMP_MILLISECONDS,
    maxCatchUpSeconds: MAX_CATCH_UP_SECONDS,
    beforeTick: () => actorViews.capturePreviousPoses(actorsByKind().mobile),
    onFault: () => {
      simulationFaulted = true;
      input.cancelGesture();
      placement.fault();
      training.fault();
      controlsDirty = true;
      canvas.dataset.simulationFault = "true";
    },
    afterTick: (outcomes) => {
      minimap.refreshActors();
      const moveStatus = unitControls.onOutcomes(outcomes);
      if (moveStatus) canvas.dataset.moveStatus = moveStatus;
      for (const outcome of outcomes) {
        placement.onOutcome(outcome);
        training.onOutcome(outcome);
        economyControls?.onOutcome(outcome);
        const { command, accepted } = outcome;
        if (command.kind === "train-unit")
          canvas.dataset.trainingStatus = accepted ? "accepted" : "rejected";
        if (command.kind === "move") {
          if (accepted)
            canvas.dataset.actorTarget = `${command.target.x},${command.target.z}`;
          else movementPath.showRejectedTarget(command.actorId, command.target);
        }
        if (
          (command.kind === "remove-actor" ||
            command.kind === "sell-actor" ||
            command.kind === "cancel-construction") &&
          command.actorId === pendingRemovalId
        )
          pendingRemovalId = undefined;
        if (
          command.kind === "place-actor" ||
          command.kind === "remove-actor" ||
          command.kind === "sell-actor" ||
          command.kind === "cancel-construction"
        ) {
          canvas.dataset.tilePlacedActorCommand = accepted
            ? "accepted"
            : "rejected";
        }
      }
    },
  });
  const renderObserver = view.scene.onBeforeRenderObservable.add(() => {
    loop.advance();
    if (simulation.actorVersion !== knownActorVersion) {
      knownActorVersion = simulation.actorVersion;
      controlsDirty = true;
      input.retainSelection((id) => !!simulation.actorById(id));
      const { placed } = actorsByKind();
      tilePlacedViews.update(placed);
      canvas.dataset.tilePlacedActorCount = String(placed.length);
      minimap.refreshActors();
    }
    if (placement.active) placement.update();
    if (simulation.economy) {
      materialsView?.update(simulation.economy);
      if (simulation.completedTicks !== knownControlsTick)
        tilePlacedViews.update(actorsByKind().placed);
    }
    if (
      controlsDirty ||
      simulation.completedTicks !== knownControlsTick ||
      placement.active !== knownPlacementActive
    )
      refreshControls();
    const frameTime = performance.now();
    if (controls.animate?.checked ?? !reducedMotion.matches) {
      idleSeconds += (frameTime - previousFrameTime) / 1000;
    }
    if (!reducedMotion.matches)
      pickupSeconds += (frameTime - previousFrameTime) / 1000;
    previousFrameTime = frameTime;
    tilePlacedViews.animate(idleSeconds);
    materialsView?.animate(pickupSeconds);
    const { mobile } = actorsByKind();
    actorViews.update(
      mobile,
      loop.tickProgress(),
      new Set(
        simulation.economy?.harvesters
          .filter((worker) => worker.phase === "gathering")
          .map((worker) => worker.actorId),
      ),
    );
    movementPath.update(mobile);
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
    selectActor: (actorId, additive = false) => {
      if (simulationFaulted || placement.active) return;
      input.select(
        actorId && simulation.actorById(actorId) ? actorId : undefined,
        additive || input.additiveMode,
      );
    },
    selectActors: (ids) => {
      if (simulationFaulted || placement.active) return;
      input.selectMany(ids.filter((id) => !!simulation.actorById(id)));
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
      actorViews.update(actorsByKind().mobile, loop.tickProgress());
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

export function createPrototypeMap(): TerrainMap {
  return new TerrainMap({
    width: TILE_COUNT,
    height: TILE_COUNT,
    tileSize: TILE_SIZE,
    createHeight: prototypeHeightAt,
    createTerrain: prototypeTerrainAt,
    terrainTypeIds: ["plain", "path", "rough", "water"],
    createLayers: (x, z) => {
      const terrain = prototypeTerrainAt(x, z);
      const variation = Math.sin(x * 0.23) * 0.025 + Math.cos(z * 0.19) * 0.02;
      const depth =
        1 -
        Math.hypot(x + 0.5 - WATER_CENTER.x, z + 0.5 - WATER_CENTER.z) /
          WATER_HALF_WIDTH;
      const terrainTint =
        terrain.typeId === "path"
          ? [1.08, 0.98, 0.78]
          : terrain.typeId === "rough"
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

      if (terrain.typeId === "rough" || Math.sin(x * 0.47 - z * 0.29) > 0.82) {
        layers.push({
          type: PROTOTYPE_TILE_TYPES.clutter,
          color: new Color4(0.99, 0.66, 0.33, 1),
        });
      }

      return layers;
    },
  });
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
