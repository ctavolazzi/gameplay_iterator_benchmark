# Review of Claude's player

Written 2026-10-04 at CT's request ("run the program and let it go until something happens,
then review the program for the bot you built"), by the session that built it. Read from
the source in full, the journal (1,079 steps at the time) and the server's logs. No engine
settings file and no design records exist in this repository, so nothing was checked
against either.

**Verdict at the time: changes required.** It plays well when nothing unusual happens and
fails badly when something does, and almost none of the code that failed was tested.

CT chose "fix the required changes". The table at the end says what was done about each.

## What happened during the run

Left alone from 05:59, the player did nothing. Since 05:45 it had slept at each dusk, woken
in the corner at the foot of its bed, and stood there: 28 minutes, two game days and part of
a third. A chest put into the base the turn before stood in the one cell between that corner
and the rest of the room, with the bed on the corner's other side. CT, watching the game,
said "it's not doing anything" before the watcher's 7 minutes of silence were up.

## What is good

- It does play by itself. In its best stretch it went from stone tools to a full set of
  diamond armour in 21 minutes with no step queued by hand. 12 advancements in the server's
  logs, against 3 for Codex's player in the same world.
- The planner is the best part: one next step from the game's own recipes, no game
  connection, and a test that plays from empty hands to an iron pickaxe. That test caught a
  real fault before the game did.
- Everything is journalled, so every number in NOTES.md can be checked.
- Edits take effect without a restart, which is what made 13 rounds of fixes possible.
- The bed, the chest and the shield each ended a whole class of failure once they worked.

## What was wrong

Numbers are from the journal as it stood. File and line are as they were at the review.

**Tests.** 16 tests covered 2 of 7 files, about 260 of 2,336 lines. Nothing tested the
reflexes, the brain, the helpers or chat. Every one of the 21 deaths and every stall came
from untested code and was found by the game killing or trapping the player.

**Shape.** `make` in lib.mjs is 811 lines, `think` in brain.mjs about 340, `serve` in
player.mjs about 300, `tick` in reflexes.mjs was 222. Those four held nearly all the
decisions. Every threshold is a number in the code. One `memory` object with 23 fields is
written from 8 files, with no list of what belongs in it.

**Design.**
- Reflexes ran one at a time and some took a long time. Digging in was awaited inside the
  tick, so nothing else was looked at meanwhile: 16 hits in 15 seconds with a sword in the
  pack (death 10).
- `make()` in lib.mjs changes the pathfinder's rules every time it is called, which is four
  times a second from the reflexes alone.
- Safety could be switched off as a side effect. `nightPass` and `brave` were timestamps the
  brain set while merely considering a goal, in five places. `brave` is what walked the
  player up to a creeper (death 11).
- Control flow depends on the wording of error messages: the brain decides whether a failure
  counts by matching words like "night" in the note, and the stall watchdog does the same.
- My own rules collided. Three stalls had one shape: a doorway closed with planks that may
  not be dug, a chest put where it blocked the way out, a base that could not be got back
  into. Each rule was fine alone.

**The game.**
- It sees through rock: ore is found by searching blocks it could not see, as the
  benchmark's hidden player does. "Diamonds!" five minutes after a restart means less than
  it sounds.
- A death costs everything carried. The chest protects spares only.
- Speed is not measured. The block searches are heavy and the machine's load was 13, but
  nothing times how long a decision takes.
- Where the time went: `collect` took 4,198 s, the most of any skill, and failed 49 times of
  128. `surface` failed 24 of 28, `explore` 44 of 77, `goto` 21 of 48, `sleep` 10 of 21.
  Putting down and picking up tables and furnaces was 399 of the 1,079 steps, nearly all
  from the hour before `leaves()`.

**Smaller.** A dead condition in `stash` (`&& false`). Hunting used the first sword found,
not the best. The reflex file's header still said version 4. LOOP.md said everything but
player.mjs reloads on a save, which is not true of pure.mjs. Anyone in the game can type
"stop" or "come" and be obeyed. The race's own code (a white bed only, the lily dye) is
still in the brain. The death count shown to CT read 18 when the server's log had 21.

## The required changes, and what was done

| # | Required | Done | How it was checked | Left |
| --- | --- | --- | --- | --- |
| 1 | The idle fallback tried one way and gave up, so a failing climb meant standing still all day. | brain.mjs tries each way in turn: the climb, the walk home, a look around. | In the game: with the climb marked as failing it went exploring instead of standing. | No test: the brain still has none. |
| 2 | Tests for the reflexes: split deciding from doing. | reflexes.mjs is now `decide()` (touches nothing) and `tick()` (senses and acts). tests/claude_reflexes.test.mjs holds `decide` against deaths 1, 4, 7, 9, 10, 11, 12, 13 to 20 and 21. | 12 tests pass. Five faults planted one at a time each turned the matching test red. In the game the new reflexes fought and killed a zombie within a minute of going live. | `tick()`, the doing half, has no test. |
| 3 | Long reflex actions must not hold off the others. | The dig-in runs beside the ticks as a task and is stopped the moment another rule wants the player. `digIn` also looks for the stop between its steps. | Read, and the rule that starts it is tested. | Not yet seen stopped in the game. Eating (6 s at most) is still awaited. |
| 4 | Furniture checked against the way out before it is put down. | `reaches` and `shutIn` in pure.mjs; `build_base` asks before each piece and looks again after; the layout keeps the middle row and the bed's corner clear. | A test rebuilds the turn-13 room and finds the shut-in corner. | The check knows the 3 by 3 room only. |
| 5 | One owner for the safety overrides; none may silence creepers or breath. | A pass (`night`, `brave`) is a field of a step. player.mjs sets it when the step starts and clears it when it ends; nothing else writes it. The two timestamps are gone. | Tests: a brave pass does not cover a creeper; a night pass holds off the dig-in and nothing else. | Nothing. |

Also done: the dead condition removed; hunting uses the best sword; the reflex header
rewritten; LOOP.md corrected about pure.mjs; the death count is taken from the journal.

## Not done

- The four long functions are as long as they were, except `tick`.
- `memory` still has no list of its fields.
- The brain has no tests. Its goal functions could be tested the way the planner is, with a
  made-up world.
- Failures are still told apart by the wording of their notes.
- Thresholds are still numbers in the code (the reflex ones are at least in one table, `R`).
- Nothing times a decision.
- Chat orders are taken from any player who is not a program.
- The race's code is still in the brain.
