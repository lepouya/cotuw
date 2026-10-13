import { expect, test, vi } from "vitest";
import { createViewRegistry } from "../src/render/view-registry";

const state = (id: string, revision = 0) => ({ id, revision });

test("disposed registries ignore late arrivals and release views once", () => {
  const dispose = vi.fn();
  const create = vi.fn(() => ({ dispose }));
  const registry = createViewRegistry({
    keyFor: (value: ReturnType<typeof state>) => value.revision,
    create,
  });
  registry.sync([state("a")]);
  registry.dispose();
  registry.sync([state("late")]);
  registry.dispose();
  expect(create).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
  expect(registry.values()).toEqual([]);
});

test("one broken cleanup does not retain other views or skip removal hooks", () => {
  const fault = new Error("Broken cleanup");
  const released: string[] = [];
  const onRemove = vi.fn();
  const registry = createViewRegistry({
    keyFor: (value: ReturnType<typeof state>) => value.revision,
    create: (value: ReturnType<typeof state>) => ({
      dispose: () => {
        released.push(value.id);
        if (value.id === "broken") throw fault;
      },
    }),
    onRemove,
  });
  registry.sync([state("a"), state("broken"), state("b")]);
  expect(() => registry.dispose()).toThrow(fault);
  expect(new Set(released)).toEqual(new Set(["a", "broken", "b"]));
  expect(onRemove).toHaveBeenCalledTimes(3);
  expect(registry.values()).toEqual([]);
  expect(() => registry.dispose()).not.toThrow();
});

test("failed replacement removes the broken view so a later sync can recover", () => {
  const dispose = vi.fn((): void => {
    throw new Error("Broken cleanup");
  });
  const create = vi.fn(() => ({ dispose }));
  const onReplace = vi.fn();
  const registry = createViewRegistry({
    keyFor: (value: ReturnType<typeof state>) => value.revision,
    create,
    onReplace,
  });
  registry.sync([state("a")]);
  expect(() => registry.sync([state("a", 1)])).toThrow("Broken cleanup");
  expect(registry.has("a")).toBe(false);
  expect(onReplace).toHaveBeenCalledWith("a", 0, 1);
  dispose.mockImplementation(() => {});
  registry.sync([state("a", 1)]);
  expect(create).toHaveBeenCalledTimes(2);
  registry.dispose();
});

test("disposal inside a factory releases the arriving view", () => {
  const dispose = vi.fn();
  const registry = createViewRegistry({
    keyFor: (value: ReturnType<typeof state>) => value.revision,
    create: () => {
      registry.dispose();
      return { dispose };
    },
  });
  registry.sync([state("a"), state("b")]);
  expect(registry.values()).toEqual([]);
  expect(dispose).toHaveBeenCalledOnce();
});

test("disposal inside revision comparison does not release the view twice", () => {
  const dispose = vi.fn();
  const create = vi.fn(() => ({ dispose }));
  const onReplace = vi.fn();
  const registry = createViewRegistry({
    keyFor: (value: ReturnType<typeof state>) => value.revision,
    create,
    sameKey: () => {
      registry.dispose();
      return false;
    },
    onReplace,
  });
  registry.sync([state("a")]);
  registry.sync([state("a", 1)]);
  expect(dispose).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
  expect(onReplace).not.toHaveBeenCalled();
  expect(registry.values()).toEqual([]);
});
