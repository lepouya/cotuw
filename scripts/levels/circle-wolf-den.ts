import { createCultivationSite } from "../../src/simulation/cultivation.ts";
import { percent } from "../../src/ui/cultivation-feedback.ts";
import { BASE_CONTENT, actorDefinition, costOf } from "./base-content.ts";
import { createWolfDenScenario } from "./wolf-den.ts";

const LIFEBLOOM = 150;
const sites = [
  createCultivationSite(
    "near-lifebloom",
    "Near Lifebloom",
    { x: 21, z: 51 },
    BASE_CONTENT.cultivationSite,
  ),
  createCultivationSite(
    "south-lifebloom",
    "South Lifebloom",
    { x: 23, z: 45 },
    BASE_CONTENT.cultivationSite,
  ),
];
const cargo = actorDefinition("circle-cultivator").cultivation!.capacity;
const { slowBelow, dormantBelow, recoverAt, capacity } =
  BASE_CONTENT.cultivationSite;

export const CIRCLE_WOLF_DEN = createWolfDenScenario({
  id: "circle-wolf-den",
  actors: [
    "circle-heartgrove",
    "circle-conservatory",
    "circle-musterhall",
    "circle-construct-nursery",
    "circle-thornspire",
    "circle-cultivator",
    "circle-sentinel",
    "circle-wayfinder",
    "circle-healer",
    "circle-briar-ram",
    "circle-artificer",
    "wolf",
    "alpha-wolf",
  ],
  name: "Circle introduction",
  briefing: {
    label: "Circle of Repose · Cultivation",
    title: "Restore the grove, Guide",
    description:
      "Grow a base, gather Lifebloom, and train Sentinels. Defeat all six wolves to win.",
    goalsHeading: "Establish your grove",
    goalsNote:
      "One worker per site gives steady income. Move workers to the other site if a reserve runs low.",
    rules: `${LIFEBLOOM} Lifebloom · Worker-tended growth · Renewable sites · Protect your Heartgrove`,
  },
  goals: [
    {
      definitionId: "circle-cultivator",
      label: "Train a Cultivator",
      directive: `Select the Heartgrove, open Units, and train a Cultivator (${costOf("circle-cultivator")} Lifebloom).`,
    },
    {
      definitionId: "circle-conservatory",
      label: "Grow a Lifebloom Conservatory",
      directive: `Select a Cultivator, open Buildings, and grow a Conservatory (${costOf("circle-conservatory")} Lifebloom).`,
    },
    {
      definitionId: "circle-musterhall",
      label: "Grow a Musterhall",
      directive: `Gather Lifebloom, then use a Cultivator to grow a Musterhall (${costOf("circle-musterhall")} Lifebloom).`,
    },
    {
      definitionId: "circle-sentinel",
      label: "Train Sentinels",
      directive: `Select the Musterhall to train Sentinels (${costOf("circle-sentinel")} Lifebloom). Wayfinders (${costOf("circle-wayfinder")}) scout but cannot fight.`,
    },
  ],
  popups: [
    {
      id: "circle-opening",
      title: "Welcome, Guide",
      text: `Select your Heartgrove, open Units, and train a Cultivator (${costOf("circle-cultivator")} Lifebloom). Then select the Cultivator and grow a Conservatory from Buildings (${costOf("circle-conservatory")} Lifebloom). Protect the Heartgrove while you build an army to clear the wolves.`,
      trigger: { kind: "actor", definitionId: "circle-heartgrove" },
    },
    {
      id: "circle-tending",
      title: "Tending growth",
      text: "Keep the Cultivator beside the building until it finishes growing. Moving or stopping the worker pauses growth. To resume, select a Cultivator and click the unfinished building. Your Heartgrove grows one building at a time.",
      trigger: { kind: "placement", definitionId: "circle-conservatory" },
    },
    {
      id: "circle-cultivation",
      title: "Cultivating Lifebloom",
      text: `Select the Cultivator and choose Gather Near Lifebloom. It carries ${cargo} Lifebloom to a Conservatory and repeats. One worker per site is sustainable. Two or more workers strain a site, and crowding it further makes it go dormant until it recovers. Select a site to see its reserve.`,
      trigger: { kind: "actor", definitionId: "circle-conservatory" },
    },
    {
      id: "circle-dormancy",
      title: "Resting the land",
      text: `A site your workers use is running low. Below ${percent(slowBelow, capacity)}% reserve, cultivation slows. At ${percent(dormantBelow, capacity)}% the site goes dormant. Workers deliver their cargo and wait until the site reopens at ${percent(recoverAt, capacity)}%. Assign a Cultivator to the other site to keep gathering while this one recovers.`,
      trigger: { kind: "site-strain" },
    },
    {
      id: "circle-army",
      title: "Gather your expedition",
      text: "Train Sentinels at the Musterhall to fight. Wayfinders scout farther but cannot attack. Select your Sentinels, choose Attack Move, and click a destination. Follow the southern path to the lone wolf, then cross the ridge to the den. Gift boxes along the route grant Lifebloom when a unit walks over them.",
      trigger: { kind: "actor", definitionId: "circle-musterhall" },
    },
    {
      id: "circle-healer",
      title: "Healers",
      text: "Idle Healers mend nearby wounded troops and workers. Select a Healer and click a wounded unit to heal it first. Healers cannot attack or mend Briar Rams; Artificers repair those.",
      trigger: { kind: "actor", definitionId: "circle-healer" },
    },
    {
      id: "circle-thornspire",
      title: "Thornspires",
      text: `A Thornspire is a tough living defense with short range and heavy shots (${costOf("circle-thornspire")} Lifebloom). A Cultivator tends it like any building; it fires at hostiles once fully grown.`,
      trigger: { kind: "placement", definitionId: "circle-thornspire" },
    },
    {
      id: "circle-nursery",
      title: "Construct Nursery",
      text: `The Nursery grows Briar Rams (${costOf("circle-briar-ram")} Lifebloom) and trains Artificers (${costOf("circle-artificer")} Lifebloom) in its own queue. Rams batter buildings but fare poorly against troops, so escort them with Sentinels. Artificers repair Rams.`,
      trigger: { kind: "actor", definitionId: "circle-construct-nursery" },
    },
  ],
  playerFaction: "circle",
  headquarters: {
    actorId: "starting-heartgrove",
    definitionId: "circle-heartgrove",
  },
  protection: {
    id: "protect-heartgrove",
    label: "Protect the Heartgrove",
    directive: "Its destruction ends this introductory mission in defeat.",
  },
  directions: {
    loneWolf:
      "Follow the southern path with Sentinels; keep the unarmed Wayfinder out of reach.",
    den: "Cross the ridge south of the split summit, then follow the path south between the den teeth. Bring Sentinels together against the pack.",
  },
  crossingLoot: (tile, index) => ({
    id: `circle-gift-${index + 1}`,
    name: ["Crossing gift", "Ridge gift"][index],
    tile,
    lifebloom: 25,
    collected: false,
  }),
  stockpiles: [
    { resource: "lifebloom", owners: ["player"], amount: LIFEBLOOM },
  ],
  sites: [],
  loot: [],
  cultivation: { sites },
});
