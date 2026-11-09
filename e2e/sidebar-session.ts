// Runs inside the page under test, like `harness.ts`. Separate from it because
// the sidebar's styles would apply to every page that loads the harness.
import { createGameSession } from "../src/session";
import { factionOf } from "../src/simulation/ownership";
import { createSidebar } from "../src/ui/sidebar";

import type { LoadedMission } from "../src/mission-loading";
import type { GameSession, GameSessionControls } from "../src/session";
import type { SidebarOptions } from "../src/ui/sidebar";

/**
 * A session with the production sidebar on the app's canvases, for specs whose
 * page uses `withoutApp`. `onStateChanged` runs after the sidebar updates.
 */
export async function startSidebarSession(
  mission: LoadedMission,
  {
    goals = [],
    onStateChanged,
    ...controls
  }: Partial<Omit<GameSessionControls, "mission">> & {
    goals?: SidebarOptions["goals"];
  } = {},
) {
  const { playerOwner, owners, economy } = mission.state;
  let view: GameSession | undefined;
  const sidebar = createSidebar(
    document.querySelector<HTMLElement>("#game-sidebar")!,
    {
      definitions: mission.definitions,
      presentations: new Map(Object.entries(mission.content.presentation)),
      economy: !!economy,
      goals,
      playerOwner,
      playerFaction: factionOf(owners, playerOwner),
      selectActor: (id, additive) => view?.selectActor(id, additive),
    },
  );
  view = await createGameSession(
    document.querySelector<HTMLCanvasElement>("#game-canvas")!,
    document.querySelector<HTMLCanvasElement>("#minimap")!,
    {
      ...sidebar.controls,
      showActor: sidebar.showActor,
      onDispose: sidebar.dispose,
      ...controls,
      mission,
      onStateChanged: (state) => {
        sidebar.update(state);
        onStateChanged?.(state);
      },
    },
  );
  return { view, sidebar };
}
