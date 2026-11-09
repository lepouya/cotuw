import { describe, expect, test } from "vitest";

import { contentRoles } from "../src/ui/content-roles";
import { createKeyedList } from "../src/ui/dom";

import type { ActorDefinition } from "../src/simulation/actor";

class ChildStub {
  parent?: ContainerStub;
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
}

class ContainerStub {
  children: ChildStub[] = [];
  insertBefore(child: ChildStub, reference: ChildStub | null) {
    child.remove();
    const index = reference
      ? this.children.indexOf(reference)
      : this.children.length;
    this.children.splice(index, 0, child);
    child.parent = this;
  }
}

function list() {
  const container = new ContainerStub();
  const created: string[] = [];
  const shown = new Map<ChildStub, number>();
  const nodes = new Map<string, ChildStub>();
  const keyed = createKeyedList<{ key: string; value: number }>(
    container as unknown as HTMLElement,
    ({ key }) => key,
    ({ key }) => {
      created.push(key);
      const node = new ChildStub();
      nodes.set(key, node);
      return {
        node: node as unknown as HTMLElement,
        update: ({ value }) => shown.set(node, value),
      };
    },
  );
  return { container, created, shown, nodes, keyed };
}

describe("createKeyedList", () => {
  test("releases removed rows and releases the remaining rows on abort", () => {
    const container = new ContainerStub();
    const released: string[] = [];
    const signal = new AbortController();
    const rows = createKeyedList(
      container as unknown as HTMLElement,
      (key: string) => key,
      (key) => ({
        node: new ChildStub() as unknown as HTMLElement,
        dispose: () => {
          released.push(key);
        },
      }),
      signal.signal,
    );
    rows.update(["a", "b"]);
    rows.update(["b"]);
    expect(released).toEqual(["a"]);
    signal.abort();
    rows.dispose();
    rows.update(["c"]);
    expect(released).toEqual(["a", "b"]);
    expect(container.children).toEqual([]);
  });

  test("reorders, updates, and removes rows without recreating them", () => {
    const { container, created, shown, nodes, keyed } = list();
    keyed.update([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
      { key: "c", value: 3 },
    ]);
    const a = nodes.get("a")!;
    const c = nodes.get("c")!;
    keyed.update([
      { key: "c", value: 30 },
      { key: "a", value: 10 },
    ]);
    expect(created).toEqual(["a", "b", "c"]);
    expect(container.children).toEqual([c, a]);
    expect(shown.get(a)).toBe(10);
    expect(nodes.get("b")!.parent).toBeUndefined();
  });

  test("keeps unowned children after its rows", () => {
    const { container, nodes, keyed } = list();
    const placeholder = new ChildStub();
    container.insertBefore(placeholder, null);
    keyed.update([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
    expect(container.children).toEqual([
      nodes.get("a"),
      nodes.get("b"),
      placeholder,
    ]);
    keyed.update([]);
    expect(container.children).toEqual([placeholder]);
  });
});

describe("contentRoles", () => {
  const definition = (
    id: string,
    role: Partial<ActorDefinition>,
  ): ActorDefinition => ({ id, behaviorId: "idle", ...role });

  test("names roles from content, not faction assumptions", () => {
    const roles = contentRoles(
      [
        // Headquarters without support does not anchor support paths.
        definition("grove", { infrastructure: { slots: 1 } }),
        definition("depot", {
          infrastructure: { slots: 1 },
          support: { radius: 10, root: true },
        }),
        definition("mill", { refinery: { harvesterDefinitionId: "crawler" } }),
        definition("crawler", {
          harvesting: { capacity: 50, loadSeconds: 10, patchRadius: 1 },
        }),
      ],
      new Map([
        ["grove", "Grove"],
        ["depot", "Depot"],
        ["mill", "Ore Mill"],
        ["crawler", "Crawler"],
      ]),
    );
    expect(roles).toEqual({
      supportHub: "Depot",
      refinery: "Ore Mill",
      harvester: "Crawler",
    });
  });

  test("falls back to generic names", () => {
    expect(contentRoles([], new Map())).toEqual({
      supportHub: "headquarters",
      refinery: "Refinery",
      harvester: "Harvester",
    });
  });

  test("uses the selected worker's paired producer and faction", () => {
    const worker = (id: string, faction: string) =>
      definition(id, {
        faction,
        harvesting: { capacity: 50, loadSeconds: 10, patchRadius: 1 },
      });
    const mill = (id: string, faction: string, workerId: string) =>
      definition(id, {
        faction,
        refinery: { harvesterDefinitionId: workerId },
      });
    const definitions = [
      definition("foreign-hub", {
        faction: "other",
        infrastructure: { slots: 1 },
        support: { radius: 10, root: true },
      }),
      definition("hub", {
        faction: "arc",
        infrastructure: { slots: 1 },
        support: { radius: 10, root: true },
      }),
      worker("foreign-worker", "other"),
      mill("foreign-mill", "other", "foreign-worker"),
      worker("worker-a", "arc"),
      mill("mill-a", "arc", "worker-a"),
      worker("worker-b", "arc"),
      mill("mill-b", "arc", "worker-b"),
    ];
    const names = new Map(definitions.map(({ id }) => [id, id]));
    expect(
      contentRoles(definitions, names, {
        definitionId: "worker-b",
        faction: "other",
      }),
    ).toEqual({
      supportHub: "hub",
      refinery: "mill-b",
      harvester: "worker-b",
    });
    expect(
      contentRoles(definitions, names, { definitionId: "mill-b" }),
    ).toEqual({
      supportHub: "hub",
      refinery: "mill-b",
      harvester: "worker-b",
    });
    expect(contentRoles(definitions, names, { faction: "circle" })).toEqual({
      supportHub: "headquarters",
      refinery: "Refinery",
      harvester: "Harvester",
    });
  });
});
