# M0 playthrough verification

[DESIGN.md](../DESIGN.md#milestone-0-playable-slice) owns the mission rules and
duration targets. [The mission browser check](../e2e/mission.spec.ts) runs the
production app from its normal opening through victory and resumed production.
It uses mouse or compact phone touch controls, including minimap navigation,
camera tilt, additive selection, and Attack Move.

## Strategy and resource budget

- Spend the starting 150 Materials on one Refinery and its Harvester.
- Gather the near patch continuously. Build one Barracks, then train one Scout
  and one Trooper.
- Scout the lone wolf from outside its detection radius. Advance the Trooper
  along the path and defeat it with Attack Move.
- Collect both crossing supplies beyond the wolf for 50 Materials.
- Train five more Troopers, scout the ridge crossing and den approach, then
  assemble the six Troopers outside the entrance and Attack Move into the den.
- Continue free play and train another Trooper.

The Barracks, Scout, and six Troopers cost 270 Materials. The recovery supplies
cover 50, leaving 220 to gather after the bootstrap. Three full deliveries
cover that expense. The 800-Materials near patch supports this strategy and
replacement forces; the 400-Materials south patch and 25-Materials base salvage
are optional. The first Trooper survives the lone-wolf fight, and the Scout
can reveal both approaches without entering wolf detection range.

## Pacing

The controlled-clock mouse and phone touch sequences reach victory in about
five minutes, including scripted waits for movement and combat. Victory timing
is recorded when the result appears, within one controlled frame of at most
one second. Both pass in Chromium and WebKit with authored resources, training
times, movement speeds, wolf health, and weapons. The test changes elapsed
time and renderer frame deltas only; it does not spawn actors, replace mission
state, grant resources, or weaken wolves.

The same mouse strategy passes at normal speed with the app's own timers and
render loop in about six minutes of wall time, including input handling and
the post-victory production check.

A familiar human replay reported by the project's developer finishes in just
under four minutes. Its speed setting and timing method are not recorded.
The developer estimates a new player's run might take roughly twice as long,
around eight minutes. That is an estimate; first-time completion times and
unaided completion remain unrecorded.

The automated and reported human runs are below the intended 10–15 minute
familiar replay. The current mission has one economy buildup and two combat
encounters, so reaching the 15–25 minute first-success target may require more
content than this slice owns.
[The roadmap audit](roadmap-audit.md#duration-target-review) tracks the target
review.

## Reproduce

Run the normal automated mouse and touch checks with:

```sh
npx playwright test e2e/mission.spec.ts --workers=1
```

Run the same strategy at normal speed, with the app's timers and render loop:

```sh
COTUW_REALTIME_PLAYTHROUGH=1 npx playwright test e2e/mission.spec.ts \
  --project=chromium --workers=1 --grep 'with mouse'
```

The report includes crossing and victory screenshots and a JSON playthrough
attachment with elapsed time. Set `COTUW_TEST_PORT` if another development
server occupies the default port. Neither mode requires developer commands in
the mission.
