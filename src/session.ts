// A playable session: the mission's simulation, its views, and its controls.
// Every mission-specific rule and look comes from the mission's content pack.
import {
  economyWorkers,
  activeSites,
  economySites,
  workersForSite,
  workingWorkerIds,
} from "./simulation/economy";
import { factionResource } from "./simulation/resources";
import { resourceBalances } from "./simulation/stockpiles";
import { createSessionSimulation, missionTerrain } from "./mission-loading";
import type { LoadedMission } from "./mission-loading";
import { createAttackMoveControls } from "./ui/attack-move-controls";
import type { AttackMoveControls } from "./ui/attack-move-controls";
import type { MissionResult } from "./simulation/objectives";
import { serializeMission } from "./simulation/mission-file";
import type { SaveInfo } from "./simulation/mission-file";
import { disconnectedBuildings, supportForOwner } from "./simulation/support";
import { rosterIncludes } from "./simulation/ownership";
import { createSupportNetworkView } from "./render/support-network";
import { createFogOverlay, limitToExplored } from "./render/fog";
import { createNetworkControls } from "./ui/network-controls";
import type { NetworkControls } from "./ui/network-controls";
import { ACTOR_REMOVAL_KINDS, isCommandOf } from "./simulation/command";
import { createEconomyControls } from "./ui/economy-controls";
import {
  createMaterialsSitesView,
  MATERIALS_COLOR,
} from "./render/materials-sites";
import { createHealthBarView } from "./render/health-bars";
import { createCombatEffectsView } from "./render/combat-effects";
import { createDamageEffectsView } from "./render/damage-effects";
import { createRegenerationEffectsView } from "./render/regeneration-effects";
import { createAmbientBirdsView } from "./render/ambient-birds";
import { createWreckView } from "./render/wrecks";
import { createFrameEffectsView } from "./render/frame-effects";
import { WRECK_SECONDS, wreckTiles } from "./simulation/combat";
import { SIMULATION_TICK_SECONDS } from "./simulation/clock";
import { Color3, Vector3 } from "@babylonjs/core";
import { TerrainMap } from "./map";
import {
  createCommandInput,
  createGameView,
  createMinimap,
  createMovementPathView,
  createActorViewRegistry,
  createTilePlacedActorViewRegistry,
  createTerrainMeshes,
  createSessionMap,
  actorAnimationState,
  extractHealthAndDamageEffects,
  createSessionAssets,
  waitForEnvironmentReady,
} from "./render";
import { isTilePlacedActor, occupiedTilesFor } from "./simulation/placement";
import type { ActorTrigger, Rgb } from "./content/presentation";
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
import type { SidebarState } from "./ui/sidebar";
import type { DefinitionButton } from "./ui/production-action";
import { trainableUnitIds } from "./simulation/production";
import type { MissionSimulation } from "./simulation/mission";
import type { BuildingActivityKind } from "./simulation/production";

import type { GameView, GameViewOptions } from "./render";
import type { ActorAnimationState } from "./render/actor";
import type { ActorRenderState } from "./simulation/actor";
import type { TileCoord } from "./simulation/grid";
import type { BuildingPlacementControls } from "./render/building-placement";
import type { ViewStyle } from "./content/content-pack";
import { createPlayerView } from "./simulation/player-view";
import { createAlertTracker } from "./ui/mission-alerts";
import type { MissionAlert } from "./ui/mission-alerts";
import { duePopup } from "./ui/popups";
import { contextualMoveCommands } from "./ui/contextual-move";
import { createRadialMenu } from "./ui/radial-menu";
import { createLifetime } from "./lifetime";
import { isTextEntry, worldInputAvailable } from "./render/input-focus";
import type { ScenarioPopup } from "./simulation/mission-file";
import type { WorldPosition } from "./simulation/world";
import { createAudioScene } from "./audio/scene";
import { createMissionAudio } from "./audio/mission";
import { SILENT_AUDIO } from "./audio/mixer";
import type { AudioMixer } from "./audio/mixer";

const SITE_MINIMAP_COLOR = MATERIALS_COLOR.asArray() as Rgb;
const SALVAGE_MINIMAP_COLOR: Rgb = [0.88, 0.65, 0.2];
const SIMULATION_PUMP_MILLISECONDS = 4;
/** Bounds each pump's work while retaining longer stalls. */
const MAX_CATCH_UP_SECONDS = 5;
/** How far past explored tile centers the camera may look, in world units. */
const CAMERA_FRONTIER_MARGIN = 4;
/** The trigger a building activity plays on the actor taking part. */
const ACTIVITY_TRIGGERS: Partial<Record<BuildingActivityKind, ActorTrigger>> = {
  delivery: "unload",
};

export type GameSession = Omit<GameView, "dispose"> & {
  simulation: MissionSimulation;
  playing: () => boolean;
  /** A fault or defeat leaves the session for inspection only. */
  halted: () => boolean;
  /** Pausing ends placement and targeting unless they are kept. */
  pause: (options?: { keepInteractions?: boolean }) => void;
  resume: () => void;
  /** Simulated seconds per real second. */
  speed: () => number;
  setSpeed: (speed: number) => void;
  /** Records a scenario popup's dismissal; rejects unknown popup IDs. */
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
    audio?: AudioMixer;
    startPaused?: boolean;
    onMenu?: () => void;
    onResult?: (result: MissionResult) => void;
    buildings?: readonly DefinitionButton[];
    economyRoot?: HTMLElement;
    onReady?: (session: GameSession) => void;
    onDispose?: () => void;
    /** Updates after simulation ticks or changes to controls and selection. */
    onStateChanged?: (state: SidebarState) => void;
    /** Reveals details for an actor the player selected or placed. */
    showActor?: (actor: ActorRenderState) => void;
    /** Receives grouped alerts after each tick. */
    onAlerts?: (alerts: readonly MissionAlert[]) => void;
    /** Shows a scenario popup once each time its trigger first holds. */
    onPopup?: (popup: ScenarioPopup) => void;
    remove?: HTMLButtonElement;
    animate?: HTMLInputElement;
    cameraControls?: HTMLElement;
  };

export async function createGameSession(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  controls: GameSessionControls,
): Promise<GameSession> {
  delete canvas.dataset.modelsReady;
  const { mission } = controls;
  const { content } = mission;
  const map = createSessionMap(missionTerrain(mission), content.terrain);
  const view = createGameView(canvas, map, viewOptions(content.view));
  try {
    return await assembleGameSession(
      canvas,
      minimapCanvas,
      controls,
      map,
      view,
    );
  } catch (error) {
    try {
      if (!view.scene.isDisposed) view.dispose();
    } catch (cleanupError) {
      console.error("Session cleanup failed.", cleanupError);
    }
    throw error;
  }
}

async function assembleGameSession(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  controls: GameSessionControls,
  map: TerrainMap,
  view: GameView,
): Promise<GameSession> {
  const { mission } = controls;
  const { content, definitions } = mission;
  const lifetime = createLifetime();
  const { own } = lifetime;
  view.scene.onDisposeObservable.add(() => lifetime.dispose());
  lifetime.defer(() => controls.onDispose?.());
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Polled, because the preference can change mid-session.
  const reducedMotion = () => motionQuery.matches;
  createTerrainMeshes(view.scene, map, {
    clips: content.clips,
    reducedMotion,
  });
  const simulation = createSessionSimulation(mission, map);
  own(simulation);
  const presentationOf = (id: string) => content.presentation[id];
  const names = new Map(
    definitions.map(({ id }) => [id, presentationOf(id)?.name ?? id]),
  );
  const frameEffects = own(
    createFrameEffectsView(view.scene, content.clips ?? {}, reducedMotion),
  );
  const assets = own(
    createSessionAssets({
      scene: view.scene,
      content,
      definitions,
      reducedMotion,
      frameEffects,
    }),
  );
  const { appearances, buildingAppearances, propAssets, buildingModelTops } =
    assets;
  const materialsView =
    simulation.economy &&
    createMaterialsSitesView(
      view.scene,
      map,
      simulation.economy,
      content.materialsStages,
    );
  if (materialsView) own(materialsView);
  const explored = ({ x, z }: TileCoord) =>
    simulation.fog?.isExplored(x, z) ?? true;
  /** An explored gathering site under a world point. */
  const siteAt = (point: WorldPosition) => {
    const { x, z } = map.tileAtWorldPosition(point.x, point.z);
    return activeSites(simulation.economy).find(
      (site) => site.tile.x === x && site.tile.z === z && explored(site.tile),
    );
  };
  const fogOverlay = createFogOverlay(
    view.scene,
    map,
    new Color3(...content.view.clearColor),
  );
  own(fogOverlay);
  const fog = simulation.fog;
  if (fog)
    view.camera.setFocusLimit((point) =>
      limitToExplored(map, fog, point, CAMERA_FRONTIER_MARGIN),
    );
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const playerOwner = simulation.playerOwner;
  const player = createPlayerView(simulation, definitionsById);
  const playerResource =
    factionResource(definitions, simulation.playerFaction) ?? "materials";
  const startingActor = simulation.actors.find(player.owns);
  if (startingActor) {
    const { x, z } = startingActor.worldPosition;
    view.camera.focusOnPoint(new Vector3(x, 0, z));
  }
  const actorViews = createActorViewRegistry(
    view.scene,
    map,
    appearances,
    (actor) => player.relationTo(actor) === "hostile",
  );
  own(actorViews);
  const tilePlacedViews = createTilePlacedActorViewRegistry(
    view.scene,
    map,
    definitions,
    buildingAppearances,
    { reducedMotion },
  );
  own(tilePlacedViews);
  const networkView = createSupportNetworkView(view.scene, map);
  own(networkView);
  const disconnected = () => disconnectedBuildings(simulation.support);
  const rallyView = createRallyPointView(view.scene, map);
  own(rallyView);
  const movementPath = createMovementPathView(view.scene, map);
  own(movementPath);
  const queuedOrders = createQueuedOrderView(view.scene, map, (order) => {
    switch (order.kind) {
      case "move":
      case "attack-move":
        return order.target;
      case "gather": {
        const site = economySites(simulation.economy).find(
          ({ id }) => id === order.siteId,
        );
        return site && map.tileCenter(site.tile.x, site.tile.z);
      }
      case "attack":
        return player.shownActor(order.targetId)?.worldPosition;
    }
  });
  own(queuedOrders);
  const healthBars = createHealthBarView(view.scene, map);
  own(healthBars);
  const combatEffects = createCombatEffectsView(
    view.scene,
    map,
    (style) => propAssets.get(style),
    reducedMotion,
  );
  own(combatEffects);
  const damageEffects = createDamageEffectsView(
    view.scene,
    (prop) => propAssets.get(prop),
    reducedMotion,
  );
  own(damageEffects);
  const regenerationEffects = createRegenerationEffectsView(
    view.scene,
    () => propAssets.get("regeneration"),
    reducedMotion,
  );
  own(regenerationEffects);
  const birds = createAmbientBirdsView(map, mission.scenario.flocks ?? [], {
    bird: () => propAssets.get("bird"),
    explored,
    reducedMotion,
  });
  own(birds);
  const wreckView = createWreckView(view.scene, map, {
    appearanceFor: (id) => appearances.get(id),
    rubble: () => propAssets.get("rubble"),
    reducedMotion,
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
  own(wreckView);
  const updateWrecks = (seconds: number) =>
    wreckView.update(
      simulation.wrecks,
      (wreck) =>
        (simulation.completedTicks - wreck.tick) * simulation.tickSeconds,
      WRECK_SECONDS,
      player.shows,
      seconds,
    );
  actorViews.update(player.actors().shownMobile, 1);
  tilePlacedViews.update(player.actors().placed, disconnected());
  let simulationFaulted = false;
  let playing = !controls.startPaused;
  const audioScene = own(
    createAudioScene(
      content.audio,
      Object.fromEntries(
        definitions.map(({ id }) => [id, presentationOf(id) ?? {}]),
      ),
      controls.audio ?? SILENT_AUDIO,
      () => view.camera.focusPoint,
      simulation.playerFaction,
    ),
  );
  /** World sounds play only while the mission runs; music continues. */
  const syncAudioActivity = () =>
    audioScene.setActive(playing && !simulationFaulted);
  syncAudioActivity();
  const missionAudio = createMissionAudio(
    audioScene,
    simulation,
    player,
    content.audio?.music?.holdSeconds ?? 0,
  );
  /** A fault or defeat leaves the session for inspection only. */
  const halted = () =>
    simulationFaulted || simulation.result?.kind === "defeat";
  const canCommand = () => playing && !halted();
  let controlsDirty = true;
  const showActor = (actorId: string) => {
    const actor = player.actor(actorId);
    if (actor) controls.showActor?.(actor);
  };
  const radial = createRadialMenu(document.body, canvas);
  own(radial);
  /** The rendered center of shown actors; undefined once none remain. */
  const cameraPointFor = (ids: readonly string[]) => {
    const points = ids.flatMap((id) => {
      const actor = player.shownActor(id);
      if (!actor) return [];
      return [
        (player.isMobile(actor) && actorViews.groundPosition(id)) ||
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
      const actor = player.actor(id);
      return !!actor && player.isMobile(actor);
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
      return player.shownActor(id)?.id;
    },
    movementTargetForMesh: (mesh) => {
      const tile = materialsView?.lootTileForMesh(mesh);
      return tile && map.tileCenter(tile.x, tile.z);
    },
    actorIdsInRect: (rect) => actorViews.actorIdsInRect(canvas, rect),
    enabled: () => !placement.active && !halted(),
    pointerEnabled: () => !view.camera.primaryPanActive,
    canCommand,
    canSelect: (id) => !!player.shownActor(id),
    groundTargetMode: () => !!groundTarget(),
    onGroundTarget: (target, queued) => groundTarget()?.choose(target, queued),
    cancelGroundTarget: () => cancelGroundTargets(),
    canMove: (actorId) => !!player.ownMobileActor(actorId),
    moveLabel: (target) => {
      const tile = map.tileAtWorldPosition(target.x, target.z);
      const at = ({ x, z }: TileCoord) =>
        x === tile.x && z === tile.z && explored(tile);
      const economy = simulation.economy;
      if (economy?.loot.some((loot) => !loot.collected && at(loot.tile)))
        return "Collect";
      const workers = workersForSite(economy, siteAt(target)?.id);
      if (
        workers.some(({ actorId }) => input.selectedActorIds.includes(actorId))
      )
        return "Gather";
      return undefined;
    },
    onContextMenu: radial.show,
    focusActor: (actorId) => focusActors([actorId]),
    canFollow: (actorId) => followableIds([actorId]).length > 0,
    followActor: (actorId) => followActors([actorId]),
    cancelFocus: view.camera.cancelFocus,
    tend: (buildingId) => {
      if (!canCommand() || !player.ownActor(buildingId)) return undefined;
      const workerId = simulation.tendWorker(
        buildingId,
        input.selectedActorIds.filter((id) => player.ownActor(id)),
      );
      return workerId
        ? () =>
            simulation.submitCommand({
              kind: "tend",
              actorId: workerId,
              buildingId,
            })
        : undefined;
    },
    canAttack: (actorId) => {
      if (!canCommand()) return false;
      const actor = player.shownActor(actorId);
      return !!actor && player.relationTo(actor) === "hostile";
    },
    submitCommand: (command) => {
      if (!canCommand()) return;
      const economy = simulation.economy;
      if (
        (command.kind === "move" || command.kind === "group-move") &&
        economy
      ) {
        const siteId = siteAt(command.target)?.id;
        for (const order of contextualMoveCommands(
          command,
          new Set(
            workersForSite(economy, siteId).map(({ actorId }) => actorId),
          ),
          siteId,
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
      audioScene.setSelection(ids);
      const actorId = ids.length === 1 ? ids[0] : undefined;
      actorViews.setSelectedActors(ids);
      tilePlacedViews.setSelectedActor(actorId);
      // Other factions' routes would reveal their intent.
      movementPath.setSelectedActors(
        ids.filter((id) => player.actors().ownIds.has(id)),
      );
      minimap.refreshActors();
      canvas.dataset.actorSelected = String(ids.length > 0);
      canvas.dataset.selectedActors = JSON.stringify(ids);
      canvas.dataset.selectedActor = actorId ?? "";
      controlsDirty = true;
    },
  });
  own(input);
  const minimap = createMinimap(view.scene, map, view.camera, minimapCanvas, {
    fog: () => simulation.fog,
    reducedMotion,
    commandMode: () => attackMove.active,
    onCommand: (target, shiftKey) => {
      if (!explored(map.tileAtWorldPosition(target.x, target.z))) return false;
      attackMove.choose(target, shiftKey || input.queueMode);
      return true;
    },
    // Structures first, so unit markers draw over them.
    actors: () => [
      ...(simulation.economy?.cultivation?.sites
        .filter((site) => explored(site.tile))
        .map((site) => ({
          id: `cultivation-${site.id}`,
          worldPosition: map.tileCenter(site.tile.x, site.tile.z),
          tiles: [site.tile],
          color: [0.68, 0.4, 0.85] as Rgb,
        })) ?? []),
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
      ...player.actors().placed.map((actor) => ({
        id: actor.id,
        worldPosition: actor.worldPosition,
        tiles: occupiedTilesFor(
          actor,
          definitionsById.get(actor.definitionId)!,
        ),
        color: buildingAppearances.get(actor.definitionId)?.minimapColor,
        selected: input.selectedActorIds.includes(actor.id),
      })),
      ...player.actors().shownMobile.map((actor) => ({
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
    const actor = player.ownActor(input.selectedActorId);
    const canRemove =
      !!actor &&
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
      ...(simulation.economy && {
        balances: resourceBalances(simulation.economy, playerOwner),
        resource: playerResource,
      }),
      objectives: simulation.objectives,
      result: simulation.result,
      relations: simulation.relations,
    });
    knownControlsTick = simulation.completedTicks;
    knownPlacementActive = placement.active;
    controlsDirty = false;
    raisePopup();
  };
  const popups = mission.scenario.popups ?? [];
  const popupIds = new Set(popups.map(({ id }) => id));
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
      workerIds: economyWorkers(simulation.economy).map(
        ({ actorId }) => actorId,
      ),
      sites: (simulation.economy?.cultivation?.sites ?? [])
        .filter((site) => explored(site.tile))
        .map((site) => ({
          id: site.id,
          name: site.name,
          dormant: site.dormant,
          reopensAt: Math.round((site.recoverAt / site.capacity) * 100),
          position: map.tileCenter(site.tile.x, site.tile.z),
        })),
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
            rosterIncludes(simulation.playerFaction, definition),
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
      workerIds: () => input.selectedActorIds,
      onPlaced: (actorId) => {
        input.select(actorId);
        showActor(actorId);
      },
      onStart: (definition) => {
        cancelGroundTargets();
        input.setBoxMode(false);
        input.setAdditiveMode(false);
        input.setQueueMode(false);
        // Selected workers are the candidates that will tend growth.
        if (!definition.growth) input.select(undefined);
        raisePopup();
      },
      onInvalid: () => audioScene.emit("command.invalid"),
    },
  );
  own(placement);
  const removeSelected = () => {
    const actor = player.ownActor(input.selectedActorId);
    if (
      !actor ||
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
  lifetime.defer(() =>
    controls.remove?.removeEventListener("click", removeSelected),
  );
  const selectedOwnActorId = () => player.ownActor(input.selectedActorId)?.id;
  const training = createUnitTraining(simulation, controls, {
    names,
    selectedActorId: selectedOwnActorId,
    unitDefinitionIds: () =>
      trainableUnitIds(player.ownActor(input.selectedActorId), definitionsById),
    enabled: () => canCommand() && !placement.active,
    paused: () => !playing,
  });
  own(training);
  const attackMove = createAttackMoveControls(simulation, controls, {
    selectedMobileIds: () =>
      input.selectedActorIds.filter((id) => !!player.ownMobileActor(id)),
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
  own(attackMove);
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
  own(rally);
  /** Modes that claim the next ground click; at most one is active. */
  const groundTargets = [attackMove, rally];
  const groundTarget = () => groundTargets.find(({ active }) => active);
  /** Returns whether any mode was active. */
  const cancelGroundTargets = () =>
    groundTargets.map((mode) => mode.cancel()).some(Boolean);
  const network = createNetworkControls(simulation, controls, {
    selectedActorId: selectedOwnActorId,
    canControl: (id) => !!player.ownActor(id),
    tileSize: map.tileSize,
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
  if (economyControls) own(economyControls);
  view.camera.setTouchPanFilter(
    (event) =>
      !placement.active &&
      !halted() &&
      !input.boxMode &&
      // Ground targeting ignores actors, so drags from them may pan too.
      (!!groundTarget() ||
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
  own(unitControls);
  const disposeCameraControls =
    controls.cameraControls &&
    bindCameraControls(controls.cameraControls, view.camera);
  if (disposeCameraControls) lifetime.defer(disposeCameraControls);
  view.camera.onViewChangedObservable.add(() => {
    controlsDirty = true;
  });
  view.camera.onPanChangedObservable.add(() => {
    input.cancelGesture();
    placement.cancelGesture();
  });
  input.select(undefined);
  if (controls.animate) controls.animate.checked = !reducedMotion();
  const syncAnimationControl = () => {
    const reduced = reducedMotion();
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
    const { bars, damaged, regenerating } = extractHealthAndDamageEffects(
      simulation.actors,
      {
        definitions: definitionsById,
        appearances,
        presentationOf,
        shows: player.shows,
        groundPositionOf: (id) => actorViews.groundPosition(id),
        buildingTopHeightOf: (id) => tilePlacedViews.topHeight(id),
        map,
        completedTicks: simulation.completedTicks,
        tickSeconds: simulation.tickSeconds,
        selectedActorIds: input.selectedActorIds,
      },
    );
    healthBars.update(bars);
    damageEffects.update(damaged, frameSeconds);
    regenerationEffects.update(regenerating, frameSeconds);
  };
  /** What a shown mobile actor's appearance reflects from committed state. */
  const animationStateOf = (
    actor: ActorRenderState,
    gathering: ReadonlySet<string>,
  ): ActorAnimationState =>
    actorAnimationState(
      actor,
      gathering,
      definitionsById,
      player.shownActor(actor.combat?.attack?.targetId),
      map,
    );

  let knownSelectionTick = simulation.completedTicks;

  const cancelInteractions = () => {
    radial.close();
    input.cancelGesture();
    cancelGroundTargets();
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
    syncAudioActivity();
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
    beforeTick: () => actorViews.capturePreviousPoses(player.actors().mobile),
    onFault: () => {
      simulationFaulted = true;
      syncAudioActivity();
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
        tilePlacedViews.update(player.actors().placed, disconnected());
      const markedTargets = new Set<string>();
      for (const hit of simulation.attacks) {
        const style = presentationOf(hit.attackerDefinitionId)?.attackEffect;
        if (
          style &&
          (simulation.sees(playerOwner, hit.from) ||
            simulation.sees(playerOwner, hit.to))
        )
          combatEffects.hit(hit, style);
        if (player.shownActor(hit.attackerId))
          actorViews.play(hit.attackerId, "attack");
        if (player.shownActor(hit.targetId))
          actorViews.play(hit.targetId, "hit");
      }
      for (const { buildingId, kind, actorId } of simulation.buildingActivity) {
        if (player.shownActor(buildingId))
          tilePlacedViews.play(buildingId, kind);
        const trigger = ACTIVITY_TRIGGERS[kind];
        if (trigger && actorId && player.shownActor(actorId))
          actorViews.play(actorId, trigger);
      }
      minimap.refreshActors();
      const alerts = observeAlerts();
      missionAudio.observe(outcomes, alerts);
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
          const target = player.shownActor(command.targetId);
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
  lifetime.defer(() => loop.stop());
  showMissionResult();
  // Loading a mission records its state without raising alerts.
  observeAlerts();
  // Weighted clip seeks must precede Babylon's animation evaluation.
  const renderObserver = view.scene.onBeforeAnimationsObservable.add(() => {
    // Polled rather than evented: the query can change before its event fires.
    syncAnimationControl();
    loop.advance();
    audioScene.update();
    // Hostiles can leave vision without any fog change, so check every tick.
    if (
      simulation.actorVersion !== knownActorVersion ||
      simulation.completedTicks !== knownSelectionTick
    ) {
      knownSelectionTick = simulation.completedTicks;
      input.retainSelection((id) => !!player.shownActor(id));
      const { placed } = player.actors();
      tilePlacedViews.update(placed, disconnected());
      canvas.dataset.tilePlacedActorCount = String(placed.length);
      minimap.refreshActors();
    }
    if (simulation.actorVersion !== knownActorVersion) {
      knownActorVersion = simulation.actorVersion;
      controlsDirty = true;
    }
    if (placement.active) placement.update();
    fogOverlay.update(simulation.fog);
    if (simulation.fog)
      canvas.dataset.exploredTiles = String(simulation.fog.exploredCount);
    if (simulation.economy) {
      materialsView?.update(simulation.economy, explored);
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
    if (!reducedMotion() && (controls.animate?.checked ?? true)) {
      idleSeconds += frameSeconds;
    }
    if (!reducedMotion()) pickupSeconds += frameSeconds;
    tilePlacedViews.animate(idleSeconds, frameSeconds);
    materialsView?.animate(pickupSeconds);
    const { shownMobile } = player.actors();
    combatEffects.update(frameSeconds);
    frameEffects.update(frameSeconds);
    updateWrecks(frameSeconds);
    birds.update(frameSeconds);
    const gathering = workingWorkerIds(simulation.economy, simulation.actors);
    actorViews.update(shownMobile, loop.tickProgress(), frameSeconds, (actor) =>
      animationStateOf(actor, gathering),
    );
    movementPath.update(shownMobile);
    // Other factions' queues would reveal their intent.
    queuedOrders.update(
      input.selectedActorIds.flatMap((id) => player.ownActor(id) ?? []),
    );
    updateHealth(frameSeconds);
    networkView.update(
      simulation.support &&
        supportForOwner(
          simulation.support,
          playerOwner,
          simulation.relations.sharesSupport,
        ),
      placement.active ||
        network.visible ||
        !!simulation.support?.nodes.some(
          (node) => node.actorId === input.selectedActorId,
        ),
    );
    rallyView.update(player.ownActor(input.selectedActorId)?.rallyPoint);
  });
  lifetime.defer(() =>
    view.scene.onBeforeAnimationsObservable.remove(renderObserver),
  );

  view.scene.onAfterRenderObservable.addOnce(() => {
    canvas.dataset.terrainReady = "true";
    canvas.dataset.actorReady = "true";
    canvas.dataset.tilePlacedActorReady = "true";
    canvas.dataset.tilePlacedActorCount = String(player.actors().placed.length);
  });

  let disposal: Promise<void> | undefined;
  const { dispose: disposeView, ...sessionView } = view;
  const session: GameSession = {
    ...sessionView,
    simulation,
    disposeAsync: () =>
      (disposal ??= (async () => {
        try {
          session.pause();
        } finally {
          try {
            await modelsReady;
            await waitForEnvironmentReady(view.scene);
          } finally {
            if (!view.scene.isDisposed) disposeView();
          }
        }
      })()),
    playing: () => playing,
    halted,
    pause: ({ keepInteractions = false } = {}) => {
      if (keepInteractions) radial.close();
      else cancelInteractions();
      if (!playing) return;
      playing = false;
      syncAudioActivity();
      controlsDirty = true;
      loop.pause();
    },
    resume: () => {
      if (halted() || disposal) return;
      if (playing) return;
      // Paused rendering settles to committed poses; resume must not rewind.
      actorViews.capturePreviousPoses(player.actors().mobile);
      playing = true;
      syncAudioActivity();
      controlsDirty = true;
      loop.resume();
    },
    speed: () => loop.speed,
    setSpeed: (speed) => {
      loop.setSpeed(speed);
      controlsDirty = true;
    },
    dismissPopup: (id) => {
      if (!popupIds.has(id))
        throw new RangeError(`Unknown scenario popup: ${id}.`);
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
      if (halted() || placement.active) return;
      input.select(
        player.shownActor(actorId)?.id,
        additive || input.additiveMode,
      );
    },
    selectActors: (ids) => {
      if (halted() || placement.active) return;
      input.selectMany(ids.filter((id) => !!player.shownActor(id)));
    },
  };
  const modelsReady = assets.load({
    onBuildingUpdated: () => {
      tilePlacedViews.update(player.actors().placed, disconnected());
    },
    onActorAppearanceUpdated: () => {
      actorViews.update(player.actors().shownMobile, loop.tickProgress());
      updateWrecks(0);
    },
    onPropLoaded: (id, asset) => {
      if (id === "cultivation-site") materialsView?.setCultivation(asset);
      else if (id === "materials-mound") materialsView?.setMound(asset);
      else if (id === "salvage") materialsView?.setSalvage(asset);
    },
    onModelsReady: () => {
      canvas.dataset.modelsReady = "true";
    },
  });
  // World tools consume Escape before the menu fallback.
  const menuKey = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isTextEntry(event.target) ||
      !worldInputAvailable(canvas.ownerDocument)
    )
      return;
    if (controls.onMenu) {
      event.preventDefault();
      controls.onMenu();
    }
  };
  window.addEventListener("keydown", menuKey);
  lifetime.defer(() => window.removeEventListener("keydown", menuKey));
  try {
    controls.onReady?.(session);
  } catch (error) {
    try {
      await session.disposeAsync();
    } catch (cleanupError) {
      console.error("Session cleanup failed.", cleanupError);
    }
    throw error;
  }
  return session;
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
