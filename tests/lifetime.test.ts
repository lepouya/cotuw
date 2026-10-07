import { expect, test, vi } from "vitest";

import { createLifetime } from "../src/lifetime";

test("resources release in reverse order once, including late arrivals", () => {
  const lifetime = createLifetime();
  const calls: number[] = [];
  const resource = { dispose: () => calls.push(1) };
  expect(lifetime.own(resource)).toBe(resource);
  lifetime.defer(() => calls.push(2));
  lifetime.dispose();
  lifetime.dispose();
  lifetime.own({ dispose: () => calls.push(3) });
  expect(calls).toEqual([2, 1, 3]);
});

test.each([new Error("cleanup failed"), undefined])(
  "a failing cleanup still releases other resources",
  (fault) => {
    const lifetime = createLifetime();
    const release = vi.fn();
    lifetime.defer(release);
    lifetime.defer(() => {
      throw fault;
    });
    let failed = false;
    try {
      lifetime.dispose();
    } catch (error) {
      failed = true;
      expect(error).toBe(fault);
    }
    expect(failed).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(() => lifetime.dispose()).not.toThrow();
  },
);
