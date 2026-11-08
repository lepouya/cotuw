import { expect, test } from "./fixtures";
import { MissionDriver } from "./mission-driver";
import { importMission, openOpening } from "./prototype-helpers";
import { WEBKIT } from "./tags";

for (const kind of ["victory", "defeat", "draw"] as const)
  test(
    `owner-based ${kind} freezes play and survives save/load`,
    { tag: WEBKIT },
    async ({ page }) => {
      await openOpening(page);
      const checkpoint = await page.evaluate(async (kind) => {
        const path: string = "/e2e/missions.ts";
        const { level, placeBuildings, missionSource, simulateMission } =
          (await import(path)) as typeof import("./missions");
        const actorPath: string = "/src/simulation/actor.ts";
        const { createActor } = (await import(
          actorPath
        )) as typeof import("../src/simulation/actor");
        const mission = level();
        const definitionId = "arc-command-center-prototype";
        mission.scenario = {
          ...mission.scenario,
          objectives: [],
          popups: [],
          skirmish: {
            owners: ["player", "rival"],
            startingResourceSites: { player: [], rival: [] },
            qualifyingDefinitionIds: [definitionId],
          },
        };
        let { state } = mission;
        state.actors = state.actors.filter(
          (actor) => actor.id === "starting-command-center",
        );
        const home = state.actors[0];
        state.actors.push(
          createActor({
            id: "observer",
            definitionId: "arc-scout",
            owner: "player",
            worldPosition: {
              x: home.worldPosition.x - 2,
              z: home.worldPosition.z,
            },
          }),
        );
        state.objectives = [];
        state.owners.push({ id: "rival", faction: "arc" });
        state.relationships.push({
          owners: ["player", "rival"],
          relationship: "hostile",
        });
        state.economy!.stockpiles.push({
          resource: "materials",
          owners: ["rival"],
          amount: 150,
        });
        placeBuildings(mission, [
          {
            actorId: "enemy",
            definitionId,
            origin: { x: 12, z: 49 },
            owner: "rival",
          },
        ]);
        const simulation = simulateMission(mission);
        for (let tick = 0; tick < 17_999; tick++) simulation.tick();
        state = simulation.snapshot() as typeof state;
        simulation.dispose();
        const source = missionSource(mission, state, {
          name: "Before result",
          savedAt: new Date().toISOString(),
        });
        localStorage.setItem("cotuw.save.autosave", source);
        if (kind !== "victory")
          state.commands.push({
            tick: state.tick,
            issuer: { owner: "player" },
            command: { kind: "sell-actor", actorId: "starting-command-center" },
          });
        if (kind !== "defeat")
          state.commands.push({
            tick: state.tick,
            issuer: { owner: "rival" },
            command: { kind: "sell-actor", actorId: "enemy" },
          });
        return {
          source: missionSource(mission, state, {
            name: "At result",
            savedAt: new Date().toISOString(),
          }),
          previous: source,
        };
      }, kind);
      await importMission(page, checkpoint.source);
      await expect(page.locator("#game-menu-title")).toHaveText(
        "Mission loaded",
      );
      await page.locator("#resume-mission").click();
      const title = kind[0].toUpperCase() + kind.slice(1);
      await expect(page.locator("#game-menu-title")).toHaveText(title);
      await expect(page.locator("#game-menu-description")).toContainText(
        "frozen for inspection",
      );
      await expect(page.locator("#resume-mission")).toBeHidden();
      await expect(page.locator("#save-mission")).toBeEnabled();
      await expect(page.locator("#quicksave-mission")).toBeEnabled();
      await page.locator("#inspect-loaded-mission").click();
      await expect(page.locator("#game-menu")).not.toBeVisible();
      await expect(page.locator("#pause-mission")).toBeDisabled();
      await expect(page.locator("[data-speed]").first()).toBeDisabled();
      await expect(page.locator("#placement-status")).toContainText(
        "Match ended",
      );
      await page.locator("#tab-units").click();
      const observer = page.locator('button[data-actor-id="observer"]');
      await expect(observer).toBeEnabled();
      await observer.click();
      await expect(observer).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("F5");
      await expect(page.locator("#notifications")).toContainText(
        "Quick save complete",
      );
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("cotuw.save.quicksave")!),
      );
      expect(saved.state.tick).toBe(18_000);
      expect(saved.state.skirmishResult).toMatchObject({ kind, tick: 17_999 });
      for (const owner of saved.state.metrics.owners) {
        expect(owner.history).toHaveLength(61);
        expect(owner.history[60].tick).toBe(17_999);
      }
      expect(
        await page.evaluate(() => localStorage.getItem("cotuw.save.autosave")),
      ).toBe(checkpoint.previous);
      await page.keyboard.press("F9");
      await expect(page.locator("#game-menu-title")).toHaveText(title);
      await expect(page.locator("#resume-mission")).toBeHidden();
      await page.locator("#inspect-loaded-mission").click();
      await page.locator("#open-menu").click();
      await expect(page.locator("#game-menu-title")).toHaveText(title);
      await page.keyboard.press("Escape");
      await expect(page.locator("#game-menu")).not.toBeVisible();
    },
  );

test(
  "skirmish metrics follow a playable economy and production opening",
  { tag: WEBKIT },
  async ({ page }, testInfo) => {
    const driver = new MissionDriver(page, false, false);
    await driver.opening();
    const source = await page.evaluate(async () => {
      const path: string = "/e2e/missions.ts";
      const { level, placeBuildings, missionSource } = (await import(
        path
      )) as typeof import("./missions");
      const mission = level();
      mission.scenario = {
        ...mission.scenario,
        objectives: [],
        popups: [],
        skirmish: {
          owners: ["player", "rival"],
          qualifyingDefinitionIds: [
            "arc-command-center-prototype",
            "arc-field-barracks",
            "arc-materials-refinery",
          ],
          startingResourceSites: { player: ["near-materials-1"], rival: [] },
        },
      };
      const { state } = mission;
      state.objectives = [];
      state.actors = state.actors.filter((actor) => actor.owner === "player");
      state.owners.push({ id: "rival", faction: "arc" });
      state.relationships.push({
        owners: ["player", "rival"],
        relationship: "hostile",
      });
      placeBuildings(mission, [
        {
          actorId: "enemy",
          definitionId: "arc-command-center-prototype",
          owner: "rival",
          origin: { x: 49, z: 39 },
        },
      ]);
      return missionSource(mission);
    });
    await importMission(page, source);
    await driver.press("#resume-mission");
    await driver.place("refinery", 12, 49);
    await driver.press("#train-harvester");
    await driver.advance(6);
    await driver.select("Harvester");
    await driver.press(
      '#gather-sites [data-economy-action="gather:near-materials-1"]',
    );
    await driver.materials(100);
    await driver.place("barracks", 16, 54);
    await driver.materials(45);
    await driver.press("#train-scout");
    await driver.press("#train-trooper");
    await driver.advance(7);
    await page.keyboard.press("F5");
    await expect(page.locator("#notifications")).toContainText(
      "Quick save complete",
    );
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cotuw.save.quicksave")!),
    );
    const owner = saved.state.metrics.owners[0];
    expect(owner).toMatchObject({
      unitsProduced: 3,
      buildingsCompleted: 2,
      peakArmy: 1,
      spent: { materials: 295, lifebloom: 0 },
      unitsLost: 0,
      buildingsLost: 0,
    });
    expect(owner.gathered.materials).toBeGreaterThanOrEqual(200);
    expect(owner.milestones.firstIncome).toBeGreaterThan(0);
    expect(owner.milestones.militaryReady).toBeGreaterThan(
      owner.milestones.firstIncome,
    );
    expect(owner.milestones.firstCombatUnit).toBeGreaterThan(
      owner.milestones.militaryReady,
    );
    expect(owner.history[0]).toMatchObject({ tick: 0, units: 0, buildings: 1 });
    expect(saved.state.metrics.owners[1].unitsProduced).toBe(0);
    await testInfo.attach("metrics-opening", {
      body: Buffer.from(JSON.stringify(saved.state.metrics, null, 2)),
      contentType: "application/json",
    });
    await page.keyboard.press("F9");
    await expect(page.locator("#game-menu-title")).toHaveText("Mission loaded");
    await driver.press("#resume-mission");
    await driver.advance(1);
    await page.keyboard.press("F5");
    await expect(page.locator("#notifications")).toContainText(
      "Quick save complete",
    );
    const restored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cotuw.save.quicksave")!),
    );
    expect(restored.state.metrics.owners[0].milestones).toEqual(
      owner.milestones,
    );
    expect(restored.state.metrics.owners[0].spent).toEqual(owner.spent);
  },
);
