# Claude's player: notes

Started 2026-10-03. World: the local co-op world on `127.0.0.1:25566` (Minecraft 26.1,
survival, normal difficulty, seed 7040093665601660210), shared with CT (`fogsift`) and
another session's `CodexBot`. Player name: `Claude`. [LOOP.md](LOOP.md) is the procedure.

## Goal ladder

Advancements, in the order they are being tried. Earned means the server's log said so.

| Advancement | Needs | State |
| --- | --- | --- |
| Stone Age | cobblestone picked up | earned 2026-10-03 17:34:38 |
| Getting an Upgrade | a stone pickaxe | earned 2026-10-03 17:34:49 |
| Acquire Hardware | an iron ingot (furnace, coal, iron ore) | next |
| Isn't It Iron Pick | an iron pickaxe | next |
| Suit Up | any iron armour | |
| Monster Hunter | kill a hostile | |
| Sweet Dreams | sleep in a bed (3 wool, 3 planks) | |
| A Seedy Place | plant a seed | |
| Hot Stuff | a bucket of lava | |
| Not Today, Thank You | block an arrow with a shield | |
| Diamonds! | a diamond | |
| Ice Bucket Challenge | obsidian | |

The game's first advancement, "Minecraft" (have a crafting table), is not announced in
chat or in the server log, so nothing here can see it. It is not counted.

## Turns

| Turn | Changed | Measured after |
| --- | --- | --- |
| 0 (17:32) | First version: player, 6 skills, reflexes. Plan: 4 logs, planks, table, sticks, wooden pickaxe, 3 stone, stone pickaxe. | 4 of 7 steps worked. The wooden pickaxe failed ("Took to long to decide path to goal!" walking to a table 14 blocks off), and the two steps after it failed because of that. |
| 0b (17:34) | `lib.craft` reports an unreachable table and `craft` then puts the carried one down; path thinking time 5 s to 15 s; the "cannot craft" message names the nearest recipe, not the first. | Retry of the 3 failed steps: all 3 worked. Stone Age and Getting an Upgrade, both in the server log. 0 damage. |

## Lessons

Each one is from the journal, with the turn it came from.

- A plan's steps depend on each other. A failed pickaxe made the next two steps fail for a
  reason that was not theirs. Dependent steps carry `"stopOnFail": true` (turn 0).
- A crafting table in sight is not a crafting table in reach. Carry one and put it down (turn 0).
- This machine is busy (load average over 5): the pathfinder needs more than its default 5 s to think (turn 0).
