# Two coaches, one task: v005s and v005o

2026-10-03. Two Claude subagents were each given the same brief and worked without reading
each other: start from playbook v004 and its stored runs (22, 24, 25, 26), write a better
playbook, and play at most 3 live runs with the local model (Qwen3.5-0.8B) as the brain.
One was a Sonnet 5.5 agent (wrote `v005s`), one an Opus 5.5 agent (wrote `v005o`). Same
seed, same harness code (commit a468bb9), 16 decisions a run unless noted.

Every number below was read from `data/benchmark.sqlite` by the session that launched them,
not copied from their reports. Their own notes are `v005s.md` and `v005o.md` beside this file.

## The runs

Decisions count from 1. "All 11" is the decision and tick of the last milestone.

| Run | Playbook | Milestones | Furnace | All 11 | Failed | Damage | Median think | One option only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22 | v004 | 11 | 13, tick 6576 | 13, tick 6576 | 2 | 0 | 3.67 s | 8 of 25 |
| 24 | v004 | 11 | 14, tick 6740 | 14, tick 6740 | 1 | 3 | 3.47 s | 9 of 16 |
| 25 | v004 (Andy model) | 11 | 12, tick 5994 | 12, tick 5994 | 1 | 0 | 3.27 s | 8 of 16 |
| 26 | v004 (with window) | 10, no furnace | none | none | 1 | 0 | 4.95 s | 8 of 16 |
| 27 | v005s, first form | 11 | 6, tick 3980 | 8, tick 4960 | 3 | 25.3, died | 3.55 s | 8 of 16 |
| 29 | v005s | 11 | 4, tick 2348 | 6, tick 3288 | 0 | 0 | 2.85 s | 15 of 16 |
| 30 | v005s (10 decisions) | 11 | 4, tick 2320 | 6, tick 3300 | 0 | 0 | 3.08 s | 9 of 10 |
| 28 | v005o, first form | 11 | 9, tick 4838 | 9, tick 4838 | 0 | 0 | 3.19 s | 12 of 16 |
| 31 | v005o | 11 | 6, tick 3576 | 7, tick 4116 | 0 | 0 | 3.37 s | 14 of 16 |
| 32 | v005o | 11 | 8, tick 3830 | 8, tick 3830 | 0 | 0 | 3.38 s | 13 of 16 |

## What it shows

- **Both beat v004 by a wide margin.** v004 needed 12 to 14 decisions and about 6000 to
  6700 ticks. v005s in its final form needs 6 decisions and about 3300 ticks. v005o needs 7
  to 8 decisions and about 3800 to 4100 ticks.
- **v005s is the faster of the two**, by one or two decisions and about 550 to 830 ticks. The
  reason is one design choice: it digs all 11 cobblestone in one job and makes the stone
  pickaxe and the furnace at the same table, so the furnace comes at decision 4.
- **v005o was the steadier while being written.** None of its three runs had a failed action,
  damage or a death. The first v005s run failed to place its table and then, after reaching
  the goal, walked north until a skeleton killed the bot: the first death in any Minecraft
  run here. Its coach fixed both before runs 29 and 30.
- **Both coaches found the same main fault in v004 by themselves:** the long walk back to a
  far crafting table. Both fixed it the same way, by putting a new table down where the work
  is. Both also added a `rest` skill for after the goal.
- **v005o's notes are the better record of what is wrong underneath.** It found that what the
  bot reports as carried goes stale (items vanish and return a dig later), and that a dig
  counts dirt picked up on the way as its pickup and leaves the ore's own drop behind. Those
  are faults in the adapter, not in any playbook.

## What it does not show

- Two runs of one final form and two of the other, on one seed, is a small sample. The gap
  between the two coaches (550 to 830 ticks) is the size of the spread among the three
  complete v004 runs (746 ticks).
- Nothing here is known to hold on another world.
- The label on a run is the playbook's name, not its content. Runs 27 and 28 played earlier
  forms of the same-named files.

## The cost of the speed: the model has almost nothing left to decide

The last column is the number of decisions where the model was offered exactly one option.
In v004 that was a third to a half. In v005s it is 15 of 16: over a whole run the model made
one real choice (coal or iron first, at decision 5). In v005o it is 13 or 14 of 16.

Both coaches made the run faster by moving decisions out of the model and into code, and both
briefings tell the model to take the first option. That is a good reflex layer: code that
reacts to the state of the game. It is not yet a model guiding play. Where the model had a
choice it did not always take the first option: 5 times in the v005o runs (3 in run 28, 2 in
run 32), and in every v005s run it dug iron before the coal that was listed first. That cost
one decision, in run 28, and nothing the other times.

For the next round the model's choices should move up a level, where a choice is real:
which goal this run goes for, what to do once it is reached, and what to do about a threat.
The job skills written here are the right floor to stand on for that.

## Decisions taken from this

- `v005s` is the playbook to build on for the road to the furnace.
- From `v005o`, keep: reading counts from a skill's own results (fewer world searches), one
  kind of wood per table, and leaving a failed skill off the next menu.
- Fix in the adapter, in this order: the ore drop left behind, the stale carried list, the
  narrow search for a spot to put the table.
