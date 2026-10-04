# Claude's player

A Minecraft player that plays by itself in CT's local co-op world, written and improved by
Claude chat sessions. It is the benchmark's idea turned round: here the code that decides
is written to play with no model in the loop, and a Claude session reads what happened and
changes that code. Built 2026-10-03 and 04. Player name in the game: `Claude`.

## If you are a new chat, start here

1. Read this file, then [NOTES.md](NOTES.md) (every turn, every death and what it changed,
   the lessons) and [REVIEW.md](REVIEW.md) (what is wrong with the program and what is left).
   [LOOP.md](LOOP.md) is the procedure for one turn of improvement.
2. Measure before believing any of it:

   ```sh
   cd /Users/ctavolazzi/Code/gameplay_iterator_benchmark
   lsof -nP -iTCP:25566 -sTCP:LISTEN            # is the world up? It is not ours to start or stop.
   node claude_player/player.mjs status          # is the player running, and what is it doing?
   node claude_player/player.mjs events 40       # what happened lately
   node claude_player/player.mjs summary         # every skill's successes and failures
   grep "Claude has" runtime/minecraft-coop-26.1/logs/latest.log    # the score, from the game
   npm test 2>&1 | grep -E "^# (pass|fail)"
   ```

3. If the player is not running and CT wants it to be: `open claude_player/play.command`.

## How to run it

| To | Do |
| --- | --- |
| Start it | `open claude_player/play.command` (its own Terminal window; Ctrl-C there leaves the game cleanly) |
| Stop it | `node claude_player/player.mjs quit` |
| Watch it | `node claude_player/player.mjs wait 60` prints everything it does for 60 s |
| Ask it to do one thing | `node claude_player/player.mjs run collect '{"block":"log","count":3}'` |
| Stop the brain, keep the reflexes | `node claude_player/player.mjs auto off` (and `auto on`) |
| Look without touching | skills `look_around`, `look_for`, `what_is`, `who_is_near`, `path_check`, `body_check`, `body_facts` |
| Be woken when something happens | `node claude_player/watch_events.mjs 3300 420` as a background task: it ends on a death, an advancement, a person speaking, an error, or 7 minutes of nothing |

Do not start it as a background task of a chat session: a session's background task is
stopped after 2 hours, and that is how it was stopped in the middle of a good run.

## How it is put together

| File | What it is |
| --- | --- |
| `player.mjs` | The process. Holds the connection, runs one skill at a time, journals everything, reconnects, answers on a local control port. |
| `reflexes.mjs` | Four times a second. `decide()` says what to do from what is sensed and touches nothing; `tick()` senses and does it. Air, shelter, running, digging in, shield, fighting, eating. |
| `brain.mjs` | Whenever nothing is running: a list of goals in order. For the first that is not done it asks the planner for one step. What fails is left alone for a while. |
| `planner.mjs` | The one next step toward having an item: from the game's own recipes, what can be dug, what can be smelted. Asked again after every step. No game connection. |
| `lib.mjs` | Everything the above are built from: walking, digging, crafting, placing, smelting, the bed, the base, hunting. |
| `chat.mjs` | Answers people in the game's chat from the player's own state. Writes a person's notes on how to play to `data/claude_player/notes.jsonl`. |
| `skills/*.mjs` | One small file per thing the player can be asked to do. |
| `pure.mjs` | Small functions with no game connection. |
| `../tests/claude_*.test.mjs` | 28 tests: the planner played from empty hands to an iron pickaxe; the reflex rules held against the situations that killed the player; the room's way out. |
| `journal/` | A copy of the journal, the memory and the advancements as they stood when this was written. The live ones are in `../data/claude_player/`, which is not in git. |

What reloads when its file is saved, with the player still running: `brain.mjs`,
`planner.mjs`, `reflexes.mjs`, `lib.mjs`, `chat.mjs` and everything in `skills/`.
What needs the player restarted: `player.mjs`, and `pure.mjs` (the others import it once).

## What CT has asked for

In his words, with the day. These are standing.

- "log in to the game on your own in your own instance, and write a loop that will call
  yourself to iterate on the game as you play, attempting to collect achievements and learn
  how to play the game, evolve" (2026-10-03)
- "your job is to write scripts that control your player. write the best little AI you can
  and make decisions along the way" (2026-10-03)
- "you're competing with Codex. try to beat it to building a base and sleeping in your bed
  near the original spawn point" (2026-10-03; done at 18:55:29, see NOTES.md)
- "make sure that you can read and respond to messages from the player, even if you're not
  mentioned by name" (2026-10-03)
- "the Player will sometimes give notes on how to play the game better. You should be able
  to listen to those text inputs through the server and actually use them to modify your
  programming, if you think it's appropriate" (2026-10-03)
- "if the other players aren't sleeping, you should put a chat message in that tells them
  to, and if they don't after 3 chat messages, you should say 'fine screw it I'm going
  mining then' or something to that effect" (2026-10-04)
- "save all of this information in the gameplay_iterator_benchmark repo so that future
  chats can benefit from your work" (2026-10-04)

And from the repository's own rules: no paid API calls in the loop; no em dashes or en
dashes; commit and push each finished piece, only your own paths; the world on port 25566
is CT's and is never started, stopped or restarted from here.

## Traps that have already cost time

- **A saved file is live at once.** The player loads `reflexes.mjs`, `brain.mjs` and `lib.mjs`
  again the moment they change. A half-finished edit is a half-finished player: twice the
  reflexes were down for a minute or more because a new file called something that did not
  exist yet. Write the thing it calls first, or work in a copy and move it into place.
- **`pure.mjs` does not reload.** Add an export to it and the running player's `lib.mjs`
  fails to load until the player is restarted.
- **Timed wakeups were not reliable in this setup.** Two that were due never ran (19:42 and
  03:38), and every turn that did run began when a background watcher ended. Use
  `watch_events.mjs` as the heartbeat and treat a timed wakeup as a fallback only.
- **Nothing happening is an event.** Left alone, the player stood in a corner for 28 minutes
  and CT saw it before the program did. The watcher's 7 minutes of silence is there for that.
- **A count in a sentence goes stale while it is typed.** Deaths and advancements come from
  the server's log at the moment of writing, not from memory. Two commit messages were wrong.
- **Other sessions work in this tree.** Codex's player, the co-op server and the Tab board
  have uncommitted files here. Commit with `git commit -F msg -- claude_player tests/claude_*.test.mjs`
  and nothing else. Their `README.md` and `notes/README.md` changes are theirs.
- **The Tab board reads `status`.** Another session's `tools/tab_board.mjs` shows CT what
  `player.mjs status` returns (health, doing, thought, lastSkill, deaths). Keep those fields.
- **`bot.wake()` is broken for this game version.** The library sends a number where 26.1
  wants the name `stop_sleeping`. `lib.mjs getUp()` sends the name.
- **The world's spawn point is in a treetop**, and a bed only holds the spawn point if it has
  been slept in since it was last put down.

## Score, from the server's logs, at 06:55 on 2026-10-04

12 advancements for `Claude`: Stone Age, Getting an Upgrade, Monster Hunter, Acquire
Hardware, Isn't It Iron Pick, Suit Up, Sweet Dreams, A Seedy Place, Diamonds!, Voluntary
Exile, Cover Me with Diamonds, Not Today, Thank You. Codex's player `CodexAstra` has 4.

21 deaths: 12 to zombies, 4 drowned, and one each to a spider, a cave spider, a skeleton, a
creeper and a magma block. NOTES.md has each one and what it changed. None since 04:32:03.

## What is next

REVIEW.md has what is left of the review. Beyond it, in the order they look worth doing:
a way into the base that stays (stairs and a door), Hot Stuff (a bucket of lava, with great
care: lava is what would take the diamond armour for good), The Parrots and the Bats (the
goal is in and has not met two chickens yet), string for a bow and a fishing rod.
