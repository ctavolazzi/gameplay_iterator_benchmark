# The loop

Claude plays Minecraft as its own player, and improves how it plays between stretches of
play. This file is the procedure one turn of the loop follows. It is the same idea as the
benchmark (play, store everything, improve the code that plays, play again), with two
differences: the player is a Claude session and not the local model, and the world is one
persistent world, not a fresh one per run.

## The parts

| File | What it is |
| --- | --- |
| `player.mjs` | The long-running player. Holds the connection, runs skills one at a time, journals everything. |
| `skills/*.mjs` | What the player can be asked to do. Loaded again whenever a file changes. **This is what improves.** |
| `lib.mjs` | The functions skills are built from (walk, dig, craft, place, smelt, eat). Also reloaded on change. |
| `reflexes.mjs` | What the player does unasked, twice a second: hit back, back away, eat. Also reloaded on change. |
| `NOTES.md` | The record: the goal ladder, one row per turn of the loop, and what has been learned. |
| `../data/claude_player/journal.jsonl` | Every skill call, hit, death, encounter and advancement. Not in git. |

## One turn

1. **Is the player there?** `node claude_player/player.mjs status`. If it does not answer, check
   that the world is up (`lsof -nP -iTCP:25566 -sTCP:LISTEN`). World up: start the player again
   in the background (`node claude_player/player.mjs serve --port 25566`). World down: stop the
   loop and say so. Never start, stop or restart the world itself; it is not this loop's.
2. **Read what happened** since the last turn: `player.mjs events 40` and `player.mjs summary`.
   Look for deaths, damage, skills that failed, time wasted, chat from other players.
3. **Check the score against the game, not the journal.** Advancements count when the server's
   log says so: `grep "Claude has" runtime/minecraft-coop-26.1/logs/latest.log`.
4. **Change one thing.** Take the worst thing step 2 showed (a death, a skill failing the same
   way twice, a slow step) and fix its cause in `skills/`, `lib.mjs` or `reflexes.mjs`. Or, when
   nothing is failing, write the skill the next goal on the ladder needs. `node --check` the file.
   One change per turn where possible, so the next turn's journal shows what it did.
5. **Play.** Queue a plan toward the next goal on the ladder in `NOTES.md` and wait for it:
   `player.mjs plan '[...]'` then `player.mjs wait 280`. Mark dependent steps `"stopOnFail": true`.
6. **Write the turn down** in `NOTES.md`: what was changed, what was measured after. A lesson
   goes under Lessons only when the journal shows it.
7. **Commit** this folder's changes when `npm test` passes: `git commit -F msg -- claude_player tests/claude_player.test.mjs`.
   Only these paths. Other sessions have uncommitted work in this repository.
8. **Schedule the next turn.** Leave a plan running that will outlast the wait.

## Rules

- No paid API calls. The loop is this chat session waking itself; `./iterate.mjs coach` and
  `loop` are never run.
- The world is shared with CT (`fogsift`) and another session's `CodexBot`. Do not dig or build
  within 12 blocks of another player, do not take from chests, do not hit players. Answer CT's
  chat when it is addressed to Claude.
- A skill is done when the journal row says what was gained, not when it returned.
- Keep each turn short. The player does the playing; the turn reads, changes one thing, queues.
- Stop the loop when CT says so, when the world is down, or after 3 turns in a row with no new
  advancement and no skill fixed.
