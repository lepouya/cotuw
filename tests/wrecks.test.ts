import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { describe, expect, test } from "vitest";

import { TerrainMap } from "../src/map";
import { createWreckView } from "../src/render/wrecks";

import type { ActorAppearance } from "../src/render/actor";
import type { Wreck } from "../src/simulation/combat";

describe("remains", () => {
  function setup() {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const map = new TerrainMap({ width: 10, height: 10, tileSize: 1 });
    const deaths: number[] = [];
    const tilted: string[] = [];
    const appearance = (die: boolean): ActorAppearance => ({
      bounds: { radius: 0.5, height: 1 },
      instantiate: (name) => ({
        root: new TransformNode(name, scene),
        die: die ? (seconds) => deaths.push(seconds) : undefined,
        freeze: () => tilted.push(name),
        dispose: () => {},
      }),
      dispose: () => {},
    });
    const appearances = new Map([
      ["trooper", appearance(true)],
      ["wolf", appearance(false)],
    ]);
    const wrecks = createWreckView(scene, map, {
      appearanceFor: (id) => appearances.get(id),
      tilesFor: () => [],
    });
    const wreck = (actorId: string, definitionId: string): Wreck => ({
      actorId,
      definitionId,
      worldPosition: { x: 0, z: 0 },
      facing: 0,
      tick: 0,
    });
    const update = (list: Wreck[], age: number, frameSeconds: number) =>
      wrecks.update(
        list,
        () => age,
        60,
        () => true,
        frameSeconds,
      );
    return { engine, deaths, tilted, update, wreck, appearances, appearance };
  }

  test("play the death clip from destruction in real time", () => {
    const { engine, deaths, update, wreck } = setup();
    const fallen = [wreck("a", "trooper")];

    update(fallen, 0.05, 0.016);
    update(fallen, 0.05, 0.05);
    update(fallen, 0.05, 1);

    expect(deaths).toEqual([0.05, 0.1, 1.1]);
    engine.dispose();
  });

  test("start loaded remains at their age", () => {
    const { engine, deaths, update, wreck } = setup();

    update([wreck("a", "trooper")], 30, 0.016);

    expect(deaths).toEqual([30]);
    engine.dispose();
  });

  test("refresh loaded appearances without restarting a death clip", () => {
    const { engine, deaths, update, wreck, appearances, appearance } = setup();
    const fallen = [wreck("a", "trooper")];
    update(fallen, 0, 0);
    update(fallen, 0, 0.5);
    appearances.set("trooper", appearance(true));
    update(fallen, 0, 0);
    expect(deaths).toEqual([0, 0.5, 0.5]);
    engine.dispose();
  });

  test("lay models without a death clip on their side", () => {
    const { engine, deaths, tilted, update, wreck } = setup();

    update([wreck("w", "wolf")], 0, 0.016);

    expect(deaths).toEqual([]);
    expect(tilted).toEqual(["wreck-w"]);
    engine.dispose();
  });
});
