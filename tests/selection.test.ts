import { expect, test } from "vitest";
import { createSelection } from "../src/render/selection";

test("selection persists on repeated clicks and Shift toggles mobile units", () => {
  const selection = createSelection((id) => id !== "building");
  selection.select("a");
  selection.select("a");
  expect(selection.ids).toEqual(["a"]);
  selection.select("b", true);
  selection.select("a", true);
  expect(selection.ids).toEqual(["b"]);
  selection.select("building", true);
  expect(selection.ids).toEqual(["building"]);
  selection.select("a", true);
  expect(selection.ids).toEqual(["a"]);
});

test("boxes exclude buildings, support addition, and prune removed units without clearing survivors", () => {
  const selection = createSelection((id) => id !== "building");
  selection.selectMany(["c", "a", "building", "a"]);
  expect(selection.ids).toEqual(["a", "c"]);
  selection.selectMany(["b"], true);
  expect(selection.ids).toEqual(["a", "b", "c"]);
  selection.retain((id) => id !== "b");
  expect(selection.ids).toEqual(["a", "c"]);
  selection.selectMany([]);
  expect(selection.ids).toEqual([]);
});
