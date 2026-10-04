# Claude's own player (2026-10-03 and 04)

CT asked a Claude session to log in to the local co-op world as its own player and to keep
improving how that player plays. Everything is in [`claude_player/`](../claude_player/):
start at [claude_player/README.md](../claude_player/README.md).

## What was built

A player named `Claude` that plays by itself: reflexes four times a second, a brain that
picks goals, a planner that works out the next step toward any item from the game's own
recipes, and small skills. A Claude session reads its journal and changes the code that
decides. No model is called while it plays, and no paid API call is made.

## What was measured, from the server's logs, by 07:00 on 2026-10-04

- 12 advancements for `Claude`: Stone Age, Getting an Upgrade, Monster Hunter, Acquire
  Hardware, Isn't It Iron Pick, Suit Up, Sweet Dreams, A Seedy Place, Diamonds!, Voluntary
  Exile, Cover Me with Diamonds, Not Today, Thank You. `CodexAstra`, Codex's player in the
  same world, had 4.
- 21 deaths: 12 to zombies, 4 drowned, one each to a spider, a cave spider, a skeleton, a
  creeper and a magma block. None after 04:32:03.
- CT's race (a base and a night in a bed near the spawn point, before Codex's player): the
  log has `Claude has made the advancement [Sweet Dreams]` at 18:55:29 on 2026-10-03.
- 79 tests pass, 28 of them this player's.

## Where to read more

| File | For |
| --- | --- |
| [claude_player/README.md](../claude_player/README.md) | how to run it, how it is put together, CT's standing instructions, the traps |
| [claude_player/NOTES.md](../claude_player/NOTES.md) | every turn of the loop, every death and what it changed, CT's notes and what was done with each, the lessons |
| [claude_player/REVIEW.md](../claude_player/REVIEW.md) | a review of the program, what was fixed, what is still wrong |
| [claude_player/LOOP.md](../claude_player/LOOP.md) | the procedure for one turn of improvement |
| [claude_player/journal/](../claude_player/journal/) | the journal (every step, hit, death, advancement), the memory and the advancements, as they stood at 06:47 on 2026-10-04 |

## What went wrong on the way, in one paragraph

The first hour had 9 deaths, most of them at night in the open; a closed hole at dusk, and
then a bed, ended those. Restarted after 6 hours stopped, it died 11 more times in two
hours, 8 of them in 131 seconds waking unarmed beside what had just killed it. Three times
its own rules shut it in (planks it would not dig, a chest in the way out, a base it could
not get back into). Twice a commit message gave a count that was already stale. The player's
process was first run as a background task of the chat session and was stopped by that
session's 2-hour limit; it is now started from a Terminal window with
`open claude_player/play.command`.
