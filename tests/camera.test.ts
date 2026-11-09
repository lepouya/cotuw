import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { afterEach, describe, expect, test } from "vitest";

import { testScene } from "./helpers/scene";
import {
  createStrategyCamera,
  orthographicViewFootprint,
  projectOntoPlane,
} from "../src/render/camera";
import { TerrainMap } from "../src/map";
import { limitToExplored } from "../src/render/fog";

import type { OrthographicFrame } from "../src/render/camera";

const fixtures: { dispose: () => void }[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
});

function navigationFixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const host = new EventTarget();
  const motion = { matches: false };
  Object.assign(host, { matchMedia: () => motion });
  const document = {
    defaultView: host,
    activeElement: undefined as unknown,
    hidden: false,
    focused: true,
    modal: false,
    covered: false,
    hasFocus: () => document.focused,
    querySelector: () => (document.modal ? {} : null),
    elementFromPoint: () => (document.covered ? null : canvas),
  };
  const attributes = new Map<string, string>();
  const canvas = Object.assign(new EventTarget(), {
    ownerDocument: document,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  });
  document.activeElement = canvas;
  const navigation = createStrategyCamera(
    scene,
    canvas as unknown as HTMLCanvasElement,
    new TerrainMap({ width: 100, height: 100, tileSize: 1 }),
  );
  navigation.resetView();
  const key = (type: string, key: string, code = key) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      key,
      code,
    });
    host.dispatchEvent(event);
    return event;
  };
  const frame = (milliseconds: number) => {
    engine.getDeltaTime = () => milliseconds;
    scene.onBeforeRenderObservable.notifyObservers(scene);
  };
  const pointer = (
    type: string,
    x = 798,
    y = 300,
    pointerType = "mouse",
    buttons = 0,
  ) => {
    const event = Object.assign(new Event(type), {
      clientX: x,
      clientY: y,
      pointerType,
      buttons,
      pointerId: 1,
      button: 0,
    });
    if (type === "pointerdown" || type === "pointerup")
      host.dispatchEvent(event);
    else canvas.dispatchEvent(event);
  };
  const target = () => (scene.activeCamera as ArcRotateCamera).target.clone();
  const fixture = {
    navigation,
    scene,
    host,
    motion,
    canvas,
    document,
    attributes,
    key,
    frame,
    pointer,
    target,
    dispose: () => {
      scene.dispose();
      engine.dispose();
    },
  };
  fixtures.push(fixture);
  return fixture;
}

/** Takes the world out of play the way each reason does. */
function leaveWorld(
  { document }: ReturnType<typeof navigationFixture>,
  reason: string,
) {
  if (reason === "hidden") document.hidden = true;
  if (reason === "focus") document.focused = false;
  if (reason === "dialog") document.modal = true;
}

describe("keyboard camera navigation", () => {
  test.each(["hidden", "focus", "dialog"])(
    "%s prevents wheel navigation",
    (reason) => {
      const fixture = navigationFixture();
      fixture.navigation.setPanMode(true);
      leaveWorld(fixture, reason);
      const wheel = Object.assign(new Event("wheel", { cancelable: true }), {
        deltaX: 30,
        deltaY: 30,
        deltaMode: 0,
      });
      fixture.canvas.dispatchEvent(wheel);
      expect(fixture.target()).toEqual(Vector3.Zero());
      expect(wheel.defaultPrevented).toBe(false);
    },
  );

  test.each(["hidden", "focus", "dialog"])(
    "%s releases held navigation and cannot restart it until the world returns",
    (reason) => {
      const fixture = navigationFixture();
      fixture.key("keydown", " ", "Space");
      fixture.key("keydown", "ArrowRight");
      fixture.frame(50);
      leaveWorld(fixture, reason);
      const before = fixture.target();
      fixture.frame(50);
      expect(fixture.target()).toEqual(before);
      expect(fixture.navigation.primaryPanActive).toBe(false);
      expect(fixture.key("keydown", " ", "Space").defaultPrevented).toBe(false);
      expect(fixture.key("keydown", "ArrowRight").defaultPrevented).toBe(false);
      fixture.document.hidden = false;
      fixture.document.focused = true;
      fixture.document.modal = false;
      fixture.frame(50);
      expect(fixture.target()).toEqual(before);
      fixture.key("keydown", "ArrowRight");
      fixture.frame(50);
      expect(fixture.target()).not.toEqual(before);
    },
  );

  test("held arrows pan by elapsed time and stop immediately on release", () => {
    const slow = navigationFixture();
    const fast = navigationFixture();
    for (const fixture of [slow, fast]) {
      fixture.navigation.glideToPoint(new Vector3(40, 0, 40));
      fixture.key("keydown", "ArrowRight");
    }
    for (let i = 0; i < 30; i++) slow.frame(1000 / 30);
    for (let i = 0; i < 60; i++) fast.frame(1000 / 60);
    expect(slow.target().length()).toBeGreaterThan(1);
    expect(slow.target().x).toBeCloseTo(fast.target().x);
    expect(slow.target().z).toBeCloseTo(fast.target().z);
    slow.key("keyup", "ArrowRight");
    const stopped = slow.target();
    slow.frame(100);
    expect(slow.target()).toEqual(stopped);
  });

  test("opposite arrows cancel, and every keyboard pan respects the focus limit", () => {
    const fixture = navigationFixture();
    fixture.key("keydown", "ArrowLeft");
    fixture.key("keydown", "ArrowRight");
    fixture.frame(100);
    expect(fixture.target()).toEqual(Vector3.Zero());
    fixture.navigation.setFocusLimit(
      (point) =>
        new Vector3(
          Math.max(-1, Math.min(1, point.x)),
          0,
          Math.max(-1, Math.min(1, point.z)),
        ),
    );
    fixture.key("keyup", "ArrowLeft");
    for (let i = 0; i < 50; i++) fixture.frame(100);
    expect(Math.abs(fixture.target().x)).toBeLessThanOrEqual(1);
    expect(Math.abs(fixture.target().z)).toBeLessThanOrEqual(1);
  });

  test("lost focus releases temporary navigation without forgetting Pan mode", () => {
    const fixture = navigationFixture();
    fixture.navigation.setPanMode(true);
    fixture.key("keydown", " ", "Space");
    fixture.key("keydown", "ArrowRight");
    fixture.frame(50);
    fixture.host.dispatchEvent(new Event("blur"));
    const before = fixture.target();
    fixture.frame(50);
    expect(fixture.target()).toEqual(before);
    expect(fixture.navigation.panMode).toBe(true);
    fixture.navigation.setPanMode(false);
    expect(fixture.navigation.primaryPanActive).toBe(false);
    fixture.key("keydown", " ", "Space");
    fixture.document.activeElement = null;
    fixture.frame(50);
    expect(fixture.navigation.primaryPanActive).toBe(false);
  });

  test("cancelling Pan ends Pan mode and held Space panning", () => {
    const fixture = navigationFixture();
    expect(fixture.navigation.cancelPan()).toBe(false);
    fixture.navigation.setPanMode(true);
    fixture.key("keydown", " ", "Space");
    expect(fixture.navigation.cancelPan()).toBe(true);
    expect(fixture.navigation.panMode).toBe(false);
    expect(fixture.navigation.primaryPanActive).toBe(false);
    expect(fixture.attributes.get("data-camera-pan-active")).toBe("false");
  });

  test("keyboard navigation does not claim shortcuts outside the world or after disposal", () => {
    const fixture = navigationFixture();
    fixture.document.activeElement = null;
    expect(fixture.key("keydown", " ", "Space").defaultPrevented).toBe(false);
    expect(fixture.key("keydown", "ArrowRight").defaultPrevented).toBe(false);
    fixture.frame(50);
    expect(fixture.target()).toEqual(Vector3.Zero());
    fixture.document.activeElement = fixture.canvas;
    fixture.navigation.setPanMode(true);
    fixture.navigation.setPanMode(false);
    fixture.dispose();
    expect(fixture.attributes.has("data-camera-pan-active")).toBe(false);
    expect(fixture.key("keydown", " ", "Space").defaultPrevented).toBe(false);
    expect(fixture.navigation.primaryPanActive).toBe(false);
  });
});

describe("edge camera navigation", () => {
  test("edge hover waits, shares arrow speed, and normalizes corner movement", () => {
    const edge = navigationFixture();
    const keyboard = navigationFixture();
    const corner = navigationFixture();
    edge.pointer("pointermove");
    corner.pointer("pointermove", 798, 598);
    edge.frame(100);
    corner.frame(100);
    expect(edge.target()).toEqual(Vector3.Zero());
    edge.frame(100);
    corner.frame(100);
    edge.navigation.focusOnPoint(Vector3.Zero());
    corner.navigation.focusOnPoint(Vector3.Zero());
    keyboard.key("keydown", "ArrowRight");
    for (let i = 0; i < 30; i++) edge.frame(1000 / 30);
    for (let i = 0; i < 60; i++) {
      keyboard.frame(1000 / 60);
      corner.frame(1000 / 60);
    }
    expect(edge.target().x).toBeCloseTo(keyboard.target().x);
    expect(edge.target().z).toBeCloseTo(keyboard.target().z);
    // Compare screen displacement since isometric axes differ on the ground.
    const expected = navigationFixture();
    expected.navigation.panView(3 / Math.SQRT2, 3 / Math.SQRT2);
    expect(corner.target().x).toBeCloseTo(expected.target().x);
    expect(corner.target().z).toBeCloseTo(expected.target().z);

    edge.navigation.setFocusLimit(() => new Vector3(1, 0, 1));
    edge.frame(100);
    expect(edge.target()).toEqual(new Vector3(1, 0, 1));
  });

  test("edges stop for leaving, buttons, controls, dialogs, hiding, and blur", () => {
    const fixture = navigationFixture();
    const stopped = (stop: () => void) => {
      fixture.pointer("pointermove");
      fixture.frame(100);
      fixture.frame(100);
      const before = fixture.target();
      stop();
      fixture.frame(100);
      expect(fixture.target()).toEqual(before);
    };
    stopped(() => fixture.pointer("pointermove", 400, 300));
    stopped(() => fixture.pointer("pointerleave"));
    stopped(() => fixture.pointer("pointerdown", 798, 300, "mouse", 1));
    stopped(() => fixture.pointer("pointermove", 798, 300, "mouse", 1));
    stopped(() => {
      fixture.document.covered = true;
    });
    fixture.document.covered = false;
    stopped(() => {
      fixture.document.modal = true;
    });
    fixture.document.modal = false;
    stopped(() => {
      fixture.document.hidden = true;
    });
    fixture.document.hidden = false;
    stopped(() => fixture.host.dispatchEvent(new Event("blur")));
    stopped(() => {
      fixture.document.focused = false;
    });
    fixture.document.focused = true;
    stopped(() => fixture.navigation.setEdgePanEnabled(false));
    expect(fixture.navigation.edgePanEnabled).toBe(false);
    fixture.pointer("pointermove");
    for (let i = 0; i < 5; i++) fixture.frame(100);
    fixture.navigation.setEdgePanEnabled(true);
    const before = fixture.target();
    fixture.frame(100);
    expect(fixture.target()).toEqual(before);
  });

  test("touch and pen input cannot start or leave behind edge hover", () => {
    const fixture = navigationFixture();
    for (const type of ["touch", "pen"]) {
      fixture.pointer("pointermove");
      fixture.frame(100);
      fixture.pointer("pointermove", 798, 300, type);
      for (let i = 0; i < 5; i++) fixture.frame(100);
      expect(fixture.target()).toEqual(Vector3.Zero());
    }
    fixture.pointer("pointermove", 900, 300);
    for (let i = 0; i < 5; i++) fixture.frame(100);
    expect(fixture.target()).toEqual(Vector3.Zero());
  });
});

describe("camera views", () => {
  const heading = (fixture: ReturnType<typeof navigationFixture>) => {
    const camera = fixture.scene.activeCamera as ArcRotateCamera;
    return { alpha: camera.alpha, beta: camera.beta };
  };
  const settle = (fixture: ReturnType<typeof navigationFixture>) => {
    for (let i = 0; i < 20; i++) fixture.frame(50);
  };

  test("a stationary press in Pan mode leaves a focus glide running", () => {
    const fixture = navigationFixture();
    fixture.navigation.glideToPoint(new Vector3(8, 0, 0));
    fixture.navigation.setPanMode(true);
    for (const type of ["pointerdown", "pointerup"])
      fixture.canvas.dispatchEvent(
        Object.assign(new Event(type), {
          button: 0,
          pointerId: 1,
          clientX: 400,
          clientY: 300,
          pointerType: "mouse",
        }),
      );
    fixture.frame(150);
    expect(fixture.target().x).toBeCloseTo(4);
    expect(fixture.navigation.cancelFocus()).toBe(true);
  });

  test("rapid repeated rotation keeps its direction across a full turn", () => {
    const fixture = navigationFixture();
    fixture.navigation.setPreset("grid");
    settle(fixture);
    const start = heading(fixture).alpha;
    for (let i = 0; i < 3; i++) fixture.navigation.rotateView(1);
    fixture.frame(150);
    expect(heading(fixture).alpha).toBeGreaterThan(start);
    settle(fixture);
    expect(heading(fixture).alpha).toBeCloseTo(start + (3 * Math.PI) / 2);
  });

  test("manual tilt interrupts a preset at its current pitch", () => {
    const fixture = navigationFixture();
    const start = heading(fixture).beta;
    fixture.navigation.setPreset("top-down");
    fixture.navigation.tiltView(0.05);
    settle(fixture);
    expect(heading(fixture).beta).toBeCloseTo(start + 0.05);
    expect(fixture.navigation.preset).toBeUndefined();
  });

  test("presets ease to their heading while keeping focus and zoom", () => {
    const fixture = navigationFixture();
    const camera = fixture.scene.activeCamera as ArcRotateCamera;
    fixture.navigation.focusOnPoint(new Vector3(5, 0, 7));
    const zoom = camera.orthoTop;
    const start = heading(fixture);
    fixture.navigation.setPreset("grid");
    expect(heading(fixture)).toEqual(start);
    fixture.frame(150);
    expect(heading(fixture).alpha).not.toBeCloseTo(start.alpha);
    settle(fixture);
    // The NNE start snaps north, its nearest cardinal direction.
    expect(heading(fixture).alpha).toBeCloseTo(-Math.PI / 2);
    expect(fixture.navigation.preset).toBe("grid");
    // Equally near diagonals resolve toward Rotate right.
    fixture.navigation.setPreset("isometric");
    settle(fixture);
    expect(heading(fixture).alpha).toBeCloseTo(-Math.PI / 4);
    fixture.navigation.setPreset("top-down");
    settle(fixture);
    expect(heading(fixture).alpha).toBeCloseTo(-Math.PI / 2);
    expect(heading(fixture).beta).toBeLessThan(0.05);
    expect(fixture.target()).toEqual(new Vector3(5, 0, 7));
    expect(camera.orthoTop).toBe(zoom);
    fixture.navigation.resetView();
    settle(fixture);
    expect(heading(fixture)).toEqual(start);
    expect(fixture.navigation.preset).toBeUndefined();
    expect(fixture.target()).toEqual(new Vector3(5, 0, 7));
  });

  test("rotation steps through preset headings and leaves presets when free", () => {
    const fixture = navigationFixture();
    const start = heading(fixture).alpha;
    fixture.navigation.rotateView(1);
    settle(fixture);
    expect(heading(fixture).alpha).toBeCloseTo(start + Math.PI / 8);
    fixture.navigation.setPreset("grid");
    fixture.navigation.rotateView(1);
    fixture.navigation.rotateView(1);
    settle(fixture);
    expect(Math.cos(heading(fixture).alpha)).toBeCloseTo(0);
    expect(Math.sin(heading(fixture).alpha)).toBeCloseTo(1);
    expect(fixture.navigation.preset).toBe("grid");
    fixture.navigation.tiltView(0.1);
    expect(fixture.navigation.preset).toBeUndefined();
    // Tilting up from Top-down holds the pitch instead of dropping it.
    fixture.navigation.setPreset("top-down");
    settle(fixture);
    const topDown = heading(fixture).beta;
    fixture.navigation.tiltView(-0.1);
    expect(heading(fixture).beta).toBe(topDown);
    fixture.navigation.tiltView(0.1);
    expect(heading(fixture).beta).toBeCloseTo(topDown + 0.1);
  });

  test("Follow eases after its target, survives zoom, and ends on pan or loss", () => {
    const fixture = navigationFixture();
    let target: Vector3 | undefined = new Vector3(10, 0, 0);
    fixture.navigation.follow(() => target);
    fixture.frame(50);
    expect(fixture.target().x).toBeGreaterThan(0);
    expect(fixture.target().x).toBeLessThan(10);
    settle(fixture);
    expect(fixture.target().x).toBeCloseTo(10);
    fixture.navigation.zoomBy(0.8);
    fixture.navigation.setPreset("grid");
    expect(fixture.navigation.following).toBe(true);
    target = undefined;
    fixture.frame(50);
    expect(fixture.navigation.following).toBe(false);
    expect(fixture.target().x).toBeCloseTo(10);
    fixture.navigation.follow(() => new Vector3(0, 0, 0));
    fixture.navigation.panView(1, 0);
    expect(fixture.navigation.following).toBe(false);
    fixture.navigation.follow(() => new Vector3(0, 0, 0));
    expect(fixture.navigation.cancelFocus()).toBe(true);
    expect(fixture.navigation.cancelFocus()).toBe(false);
  });

  test("reduced motion applies views, glides, and Follow immediately", () => {
    const fixture = navigationFixture();
    Object.assign(fixture.host, { matchMedia: () => ({ matches: true }) });
    // The query is read at creation, so build a second camera.
    const reduced = createStrategyCamera(
      fixture.scene,
      fixture.canvas as unknown as HTMLCanvasElement,
      new TerrainMap({ width: 100, height: 100, tileSize: 1 }),
    );
    const camera = fixture.scene.cameras[1] as ArcRotateCamera;
    reduced.setPreset("top-down");
    expect(camera.beta).toBeLessThan(0.05);
    reduced.glideToPoint(new Vector3(3, 0, 4));
    expect(camera.target).toEqual(new Vector3(3, 0, 4));
    reduced.follow(() => new Vector3(6, 0, 2));
    fixture.frame(1);
    expect(camera.target).toEqual(new Vector3(6, 0, 2));
  });

  test("enabling reduced motion finishes a running view and focus transition", () => {
    const fixture = navigationFixture();
    const target = new Vector3(12, 0, 7);
    fixture.navigation.glideToPoint(target);
    fixture.navigation.setPreset("top-down");
    fixture.frame(50);
    expect(fixture.target()).not.toEqual(target);
    fixture.motion.matches = true;
    fixture.frame(1);
    expect(fixture.target()).toEqual(target);
    expect(heading(fixture).beta).toBeLessThan(0.05);
    expect(fixture.navigation.cancelFocus()).toBe(false);
  });
});

test("camera glides stay within the explored frontier on every frame", () => {
  const scene = testScene();
  const map = new TerrainMap({ width: 100, height: 10, tileSize: 1 });
  const canvas = Object.assign(new EventTarget(), {
    clientWidth: 800,
    clientHeight: 600,
  });
  const camera = createStrategyCamera(scene, canvas as HTMLCanvasElement, map);
  const fog = {
    version: 0,
    exploredCount: 2,
    isExplored: (x: number, z: number) => (x === 10 || x === 90) && z === 5,
    isVisible: () => false,
  };
  camera.setFocusLimit((point) => limitToExplored(map, fog, point, 4));
  const from = map.tileCenter(10, 5);
  const to = map.tileCenter(90, 5);
  camera.focusOnPoint(new Vector3(from.x, 0, from.z));
  camera.glideToPoint(new Vector3(to.x, 0, to.z));
  scene.getEngine().getDeltaTime = () => 30;
  for (let frame = 0; frame < 11; frame += 1) {
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const target = (scene.activeCamera as ArcRotateCamera).target;
    const distance = Math.min(
      Math.hypot(target.x - from.x, target.z - from.z),
      Math.hypot(target.x - to.x, target.z - to.z),
    );
    expect(distance).toBeLessThanOrEqual(4 + 1e-9);
  }
  expect((scene.activeCamera as ArcRotateCamera).target.x).toBeCloseTo(to.x);
});

const topDown: OrthographicFrame = {
  position: new Vector3(0, 10, 0),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 0, 1),
  forward: new Vector3(0, -1, 0),
};

describe("projectOntoPlane", () => {
  test("drops straight onto the plane below a top-down frame", () => {
    expect(projectOntoPlane(topDown, 2, 3, 0)).toEqual(new Vector3(2, 0, 3));
  });

  test("follows an oblique forward vector to the target height", () => {
    // An unnormalized forward still solves correctly: it need not be a unit
    // vector, only non-horizontal.
    const frame: OrthographicFrame = {
      ...topDown,
      forward: new Vector3(0, -1, 1),
    };

    expect(projectOntoPlane(frame, 2, 3, 0)).toEqual(new Vector3(2, 0, 13));
  });

  test("lands above ground when the target height is not zero", () => {
    expect(projectOntoPlane(topDown, 0, 0, 4)).toEqual(new Vector3(0, 4, 0));
  });
});

describe("orthographicViewFootprint", () => {
  test("returns the four ground corners in order around the quad", () => {
    const bounds = { left: -1, right: 1, top: 2, bottom: -2 };

    expect(orthographicViewFootprint(topDown, bounds, 0)).toEqual([
      new Vector3(-1, 0, -2),
      new Vector3(1, 0, -2),
      new Vector3(1, 0, 2),
      new Vector3(-1, 0, 2),
    ]);
  });
});
