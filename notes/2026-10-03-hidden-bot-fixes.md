# The hidden bot gets the real window's fixes, and one of its own

2026-10-03, afternoon. Three runs with the hidden bot (`--body bot`), playbook v005s, the
local model Qwen3.5-0.8B choosing, the usual seed. Every number here was read from
`data/benchmark.sqlite` or the server's log, not from the terminal.

## What changed in `games/minecraft/adapter.mjs`

1. **Logs from the foot of a trunk.** `reachable()` now prefers a log at most 3 blocks above
   the ground under it (`heightAboveGround` in `common.mjs`), as the real window does.
2. **A dig is done when the block's own drop is carried** (`dropOf`), not when anything at
   all was gained. A dig that only picked up dirt now fails and says what it did pick up.
3. **The tool goes in hand after the walk, not before it.** Found in run 36, below.
4. **The game's advancements arrive as events** (`advancement`), read from the server's log,
   as they already did for the real window.
5. **A check of the bot's list of what it carries against the server's**, after every
   action. Where they still differ after half a second, a `stale_carried` event stores both
   counts. The comparison is `carriedDiffers` in `common.mjs`, with a test.
6. The adapter's own copies of the constants are gone; it takes them, the milestone events
   and the metrics from `common.mjs`.

## The runs

| Run | Code | Decisions | All 11 at | Iron job | Median think | Events of the new kinds |
| --- | --- | --- | --- | --- | --- | --- |
| 35 | 62b2cae, before any change | 16 | decision 6, tick 3875 | 2 digs, 21.4 s | 3.2 s | none recorded (not built yet) |
| 36 | changes 1, 2, 4, 5, 6 | 8 | decision 6, tick 4220 | 2 digs, 28.1 s | 5.8 s | Stone Age, Getting an Upgrade |
| 37 | all six | 7 | decision 6, tick 5757 | 1 dig, 14.6 s | 8.8 s | Stone Age, Getting an Upgrade |

No run had a failed decision or took damage.

## What run 36 showed: the wrong pickaxe

Change 2 was meant to stop the iron job needing two digs. It did not: the first
`collect:iron_ore` still failed, now with a clearer message, "dug the iron_ore but did not
pick up its raw_iron (picked up on the way: dirt)". The server's answer to the inventory
question after the second dig showed the stone pickaxe with 1 use on it. So the first iron
ore was dug with the wooden pickaxe, and iron ore dug that way drops nothing. There was no
drop to find.

The cause: `collect()` put the best pickaxe in hand and then walked. The pathfinder digs its
own way through dirt and puts what suits that in hand, so the tool held at the end of the
walk was not the one chosen before it. The tool now goes in hand after the walk.

In the stored runs, the iron job took 2 digs in 7 of the 8 hidden-bot runs from 27 to 36
(all but run 31). In run 37 it took 1, and the dig reported `{"dirt":3,"raw_iron":1}`.
One run is one run: this is the expected result of the fix, seen once.

## What these runs do not show

- **Run 37 is not slower because of the changes, as far as can be told, and not shown to be
  no slower either.** Its tick count is the highest of the three, but the model's thinking
  time was also 2.7 times run 35's on the same prompts, which says the machine was busy.
  Game time runs while the model thinks. A fair comparison needs runs on a quiet machine.
- **No `stale_carried` event was stored in runs 36 or 37.** The server answered the question
  each time (27 answers in run 36's log). So in two runs with v005s the bot's list agreed
  with the server's after every action. That does not explain the stale counts v005o saw in
  runs 24, 28 and 31; it only says they did not happen here. The check stays in, so the next
  time it happens the database will hold both counts.
- Whether the trunk rule changed which tree is taken: run 37 took birch where 35 and 36 took
  oak. Not looked into.

## Next

- The eight or more decisions after the goal are still `rest`. The handoff's job 4 (a goal
  per run, then free play, with real choices for the model) is the next thing worth a run.
- Reflexes (roadmap phase 2) have not been started.
