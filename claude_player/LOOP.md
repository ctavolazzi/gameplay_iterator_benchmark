# The loop

Claude plays Minecraft as its own player, and improves how it plays while it plays. The
player decides for itself what to do; a Claude chat session wakes at intervals, reads what
happened, and changes the code that decides. It is the benchmark's idea (play, store
everything, improve the code that plays, play again) with two differences: the code is
written to play without a model in the loop, and the world is one persistent world.

## The parts

| File | What it is |
| --- | --- |
| `player.mjs` | The long-running player. Holds the connection, runs one skill at a time, journals everything, reconnects. The only file that needs a restart to change. |
| `reflexes.mjs` | Four times a second: fight what is close, back away from creepers, dig in at night, eat. |
| `brain.mjs` | Whenever nothing is running: the list of goals in order, and what failed lately. Asks the planner for the next step toward the first goal that is not done. |
| `planner.mjs` | The one next step toward having an item, from the game's own recipes, what can be dug, and what can be smelted. Asked again after every step. |
| `skills/*.mjs` | What the player can do: collect, craft, place, smelt, hunt, plant, descend, surface, recover. |
| `lib.mjs` | The functions all of the above are built from. |
| `NOTES.md` | The record: the goal ladder, one row per turn of the loop, and what has been learned. |
| `../data/claude_player/` | `journal.jsonl` (every step, hit, death, encounter, advancement), `memory.json` (what the brain remembers), `advancements.json`. Not in git. |

Everything but `player.mjs` is loaded again when its file changes, so the player keeps
playing while it is edited.

## One turn

1. **Is the player there?** `node claude_player/player.mjs status`. If it does not answer, check
   that the world is up (`lsof -nP -iTCP:25566 -sTCP:LISTEN`). The player is started from a
   Terminal window with `open claude_player/play.command`, not as a background task of the chat
   session: a session's background task is stopped after 2 hours (it happened at 20:14:49 on
   2026-10-03, in the middle of a good run). If the player was stopped by that limit, say so
   and let CT start it. World down: stop the loop and say so. Never start, stop or restart the
   world itself; it is not this loop's.
2. **Read what happened** since the last turn: `player.mjs events 60`, `player.mjs summary`,
   and `thought` in `status` (the goal it is on, and why each goal above it is stuck).
   Look for deaths, damage, a step failing the same way twice, a goal that never moves.
3. **Check the score against the game, not the journal.** Advancements count when the server's
   log says so: `grep "Claude has" runtime/minecraft-coop-26.1/logs/latest.log`.
4. **Change one thing.** Take the worst thing step 2 showed and fix its cause in the file that
   owns it. `node --check` it; planner changes run `node --test tests/claude_planner.test.mjs`.
   One change per turn where possible, so the next turn's journal shows what it did.
5. **Watch it land**: `player.mjs wait 60`, and read whether the change did what was meant.
6. **Write the turn down** in `NOTES.md`: what was changed, what was measured after. A lesson
   goes under Lessons only when the journal shows it.
7. **Commit** this folder's changes when `npm test` passes, with
   `git commit -F msg -- claude_player tests/claude_player.test.mjs tests/claude_planner.test.mjs`.
   Only these paths. Other sessions have uncommitted work in this repository.
8. **Schedule the next turn.**

## Rules

- No paid API calls. The loop is this chat session waking itself; `./iterate.mjs coach` and
  `loop` are never run.
- The world is shared with CT (`fogsift`) and other sessions' players. Nothing within 12
  blocks of another player is dug, chests are left alone, players are never hit. Chat
  addressed to Claude is answered.
- A step is done when the journal row says what was gained, not when it returned.
- Stop the loop when CT says so, or when the world is down.
