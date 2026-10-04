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
| `chat.mjs`, `score.mjs`, `challenge.json` | What it says in the game's chat, and the challenge with Codex's player counted from the server's log. |
| `eyes.mjs`, `sight.mjs`, `textures.mjs` | The player's eyes: `player.mjs look` gives a picture from where it stands and what is in it in words. |
| `report.mjs`, `asks.json` | The report the session reads at the start of a turn, and the list of what has been asked for with whether each is done. |
| `RESEARCH.md` | What others have built along these lines, with sources, and what this player takes from each. |
| `NOTES.md` | The record: the goal ladder, one row per turn of the loop, and what has been learned. |
| `../data/claude_player/` | `journal.jsonl` (every step, hit, death, encounter, advancement), `memory.json` (what the brain remembers), `advancements.json`. Not in git. |

`brain.mjs`, `planner.mjs`, `reflexes.mjs`, `lib.mjs`, `chat.mjs`, `actions.mjs`, `eyes.mjs`,
`sight.mjs`, `score.mjs` and the skills are loaded
again when their file changes, so the player keeps playing while it is edited. `player.mjs`
and `pure.mjs` need the player restarted. A saved file is live at once: save what is called
before what calls it.

## One turn

1. **Is the player there?** `node claude_player/player.mjs status`. If it does not answer, check
   that the world is up (`lsof -nP -iTCP:25566 -sTCP:LISTEN`). The player is started from a
   Terminal window with `open claude_player/play.command`, not as a background task of the chat
   session: a session's background task is stopped after 2 hours (it happened at 20:14:49 on
   2026-10-03, in the middle of a good run). If the player was stopped by that limit, say so
   and let CT start it. World down: stop the loop and say so. Never start, stop or restart the
   world itself; it is not this loop's.
2. **Read the report**: `node claude_player/report.mjs`. It covers the time since the last
   one: what needs deciding first (deaths, errors, what a person asked that the player has no
   rule for, a step that failed three times the same way, a stuck goal, standing still, what
   is asked for in `asks.json` and not done), then the numbers, then a picture from the
   player's eyes all round. Read the picture too. `player.mjs events 60` and `summary` have
   the detail behind any line of it.
3. **Check the score against the game, not the journal**: `node claude_player/score.mjs`
   counts advancements and deaths from the server's log, for this player and Codex's.
   Answer what was asked in the game's chat (`player.mjs say ...`), and put anything asked
   for that is not a quick answer into `asks.json`.
4. **Change one thing.** A change to what the reflexes decide gets a test in
   `tests/claude_reflexes.test.mjs` first, written from the journal rows that show the fault. Take the worst thing step 2 showed and fix its cause in the file that
   owns it. `node --check` it; planner changes run `node --test tests/claude_planner.test.mjs`.
   One change per turn where possible, so the next turn's journal shows what it did.
5. **Watch it land**: `player.mjs wait 60`, and read whether the change did what was meant.
   For anything built or dug, look at it: `player.mjs look <thing>` and read the picture.
6. **Write the turn down** in `NOTES.md`: what was changed, what was measured after. A lesson
   goes under Lessons only when the journal shows it.
7. **Commit** this folder's changes when `npm test` passes, with
   `git commit -F msg -- claude_player tests/claude_*.test.mjs` (list the test files by name).
   Only these paths. Other sessions have uncommitted work in this repository.
8. **Schedule the next turn.** Start `node claude_player/watch_events.mjs 1200 420` as a
   background task: it ends on a death, an advancement, a person speaking, an error, or 7
   minutes of nothing, and its ending is what starts the next turn. A timed wakeup is only a
   fallback: two of them never ran.

## Rules

- No paid API calls. The loop is this chat session waking itself; `./iterate.mjs coach` and
  `loop` are never run.
- The world is shared with CT (`fogsift`) and other sessions' players. Nothing within 12
  blocks of another player is dug, chests are left alone, players are never hit. Chat
  addressed to Claude is answered.
- A step is done when the journal row says what was gained, not when it returned.
- Stop the loop when CT says so, or when the world is down.
