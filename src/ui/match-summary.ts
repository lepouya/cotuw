import { formatElapsed } from "../format-time";
import { createElement, mountFeature } from "./dom";
import { bindTabNavigation } from "./tab-navigation";
import markup from "./match-summary.html?raw";
import "./match-summary.css";

import type { MatchSummary, SummaryGraph } from "../match-summary";

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 320;
const HEIGHT = 120;
const PAD = { left: 30, right: 8, top: 8, bottom: 18 };

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  text?: string,
) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function overview({ owners, sections }: MatchSummary) {
  return sections.map(({ heading, rows }) =>
    createElement(
      "table",
      { class: "summary-table" },
      createElement("caption", {}, heading),
      createElement(
        "thead",
        {},
        createElement(
          "tr",
          {},
          createElement("th", { scope: "col" }, ""),
          ...owners.map(({ label }) =>
            createElement("th", { scope: "col" }, label),
          ),
        ),
      ),
      createElement(
        "tbody",
        {},
        ...rows.map(({ label, values }) =>
          createElement(
            "tr",
            {},
            createElement("th", { scope: "row" }, label),
            ...values.map((value) => createElement("td", {}, value)),
          ),
        ),
      ),
    ),
  );
}

/** One comparison line chart with a hover readout of both owners' values. */
function chart(
  graph: SummaryGraph,
  owners: MatchSummary["owners"],
  seconds: number,
  signal: AbortSignal,
) {
  let peak = 1;
  for (const { points } of graph.series)
    for (const [, value] of points) peak = Math.max(peak, value);
  const span = seconds || 1;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + (time / span) * plotWidth;
  const y = (value: number) => PAD.top + plotHeight * (1 - value / peak);
  const root = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    role: "img",
    "aria-label": `${graph.label} over time for ${owners.map(({ label }) => label).join(" and ")}`,
  });
  const bottom = PAD.top + plotHeight;
  root.append(
    svg("line", {
      class: "summary-axis",
      x1: PAD.left,
      x2: PAD.left + plotWidth,
      y1: bottom,
      y2: bottom,
    }),
    svg(
      "text",
      {
        class: "summary-tick",
        x: PAD.left - 4,
        y: PAD.top + 8,
        "text-anchor": "end",
      },
      String(peak),
    ),
    svg(
      "text",
      {
        class: "summary-tick",
        x: PAD.left - 4,
        y: bottom,
        "text-anchor": "end",
      },
      "0",
    ),
    svg("text", { class: "summary-tick", x: PAD.left, y: HEIGHT - 4 }, "0:00"),
    svg(
      "text",
      {
        class: "summary-tick",
        x: PAD.left + plotWidth,
        y: HEIGHT - 4,
        "text-anchor": "end",
      },
      formatElapsed(seconds),
    ),
  );
  graph.series.forEach(({ points }, index) => {
    if (!points.length) return;
    root.append(
      svg("polyline", {
        class: "summary-line",
        stroke: owners[index]!.color ?? "currentColor",
        ...(index === 1 && { "stroke-dasharray": "4 3" }),
        points: points
          .map(([time, value]) => `${x(time)},${y(value)}`)
          .join(" "),
      }),
    );
  });
  const cursor = svg("line", {
    class: "summary-cursor",
    y1: PAD.top,
    y2: bottom,
    visibility: "hidden",
  });
  root.append(cursor);
  const readout = createElement("p", { class: "summary-readout" }, " ");
  const sampleAt = (time: number) =>
    graph.series.map(({ points }) => {
      let value: number | undefined;
      for (const [at, sample] of points) {
        if (at > time) break;
        value = sample;
      }
      return value;
    });
  const read = (event: PointerEvent) => {
    const box = root.getBoundingClientRect();
    const local = ((event.clientX - box.left) / box.width) * WIDTH;
    const time = Math.min(
      span,
      Math.max(0, ((local - PAD.left) / plotWidth) * span),
    );
    cursor.setAttribute("x1", String(x(time)));
    cursor.setAttribute("x2", String(x(time)));
    cursor.setAttribute("visibility", "visible");
    readout.textContent = `${formatElapsed(time)} · ${sampleAt(time)
      .map((value, index) => `${owners[index]!.label} ${value ?? "–"}`)
      .join(" · ")}`;
  };
  root.addEventListener("pointermove", read, { signal });
  root.addEventListener("pointerdown", read, { signal });
  root.addEventListener(
    "pointerleave",
    () => {
      cursor.setAttribute("visibility", "hidden");
      readout.textContent = " ";
    },
    { signal },
  );
  return createElement(
    "figure",
    { class: "summary-chart" },
    createElement("figcaption", {}, graph.label),
    root,
    readout,
  );
}

/** The results panel's match summary, with Overview and Graphs tabs. */
export function createMatchSummary(root: HTMLElement) {
  return mountFeature(root, markup, ({ lifetime, signal, element }) => {
    const content = element("match-summary");
    const panels = [element("summary-overview"), element("summary-graphs")];
    const tabs = [
      element<HTMLButtonElement>("summary-tab-overview"),
      element<HTMLButtonElement>("summary-tab-graphs"),
    ];
    const select = (selected: number) => {
      tabs.forEach((tab, index) => {
        const active = index === selected;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        panels[index]!.hidden = !active;
      });
    };
    tabs.forEach((tab, index) =>
      tab.addEventListener("click", () => select(index), { signal }),
    );
    bindTabNavigation(element("summary-tabs"), tabs, select, signal);
    const legend = element("summary-legend");
    const charts = element("summary-charts");
    let chartListeners: AbortController | undefined;
    lifetime.defer(() => chartListeners?.abort());
    return {
      content,
      selectedTab: () => tabs.find((tab) => tab.tabIndex === 0) ?? null,
      /** Shows a summary from its Overview tab, or hides an absent one. */
      show(summary: MatchSummary | undefined) {
        chartListeners?.abort();
        chartListeners = undefined;
        content.hidden = !summary;
        if (!summary) {
          panels[0]!.replaceChildren();
          legend.replaceChildren();
          charts.replaceChildren();
          return;
        }
        panels[0]!.replaceChildren(...overview(summary));
        legend.replaceChildren(
          ...summary.owners.map(({ label, color }, index) =>
            createElement(
              "li",
              {},
              createElement("span", {
                class: index === 1 ? "summary-swatch dashed" : "summary-swatch",
                style: `color: ${color ?? "currentColor"}`,
              }),
              label,
            ),
          ),
        );
        const controller = new AbortController();
        chartListeners = controller;
        charts.replaceChildren(
          ...summary.graphs.map((graph) =>
            chart(graph, summary.owners, summary.seconds, controller.signal),
          ),
        );
        select(0);
      },
    };
  });
}
