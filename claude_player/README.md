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
| See what it sees | `node claude_player/player.mjs look` (as it stands), `look north`, `look around`, `look fogsift`, `look furnace`, `look -352 59 459`; add `--open` to show the picture. It prints where the PNG is and what is in it in words. Then read the PNG. |
| The score against Codex's player | `node claude_player/score.mjs`, counted from the server's log. `node claude_player/player.mjs score '{"say":true}'` says it in the game. |
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
| `chat.mjs` | Answers people in the game's chat from the player's own state. `reads()` says what a line asks for. Writes a person's notes on how to play to `data/claude_player/notes.jsonl`. Answers Codex's player when it asks something by name, three times in ten minutes at most, and never obeys it. `overheard()` hears the game itself: who is in bed, and each advancement and death. |
| `eyes.mjs` | The player's eyes: `look()` draws what it would see from where it stands and says what is in the picture. See "The eyes" below. |
| `sight.mjs` | The drawing itself, with no game connection: one ray for each dot of the picture through a box of block states, creatures as boxes, the writing on the picture, PNG in and out. |
| `textures.mjs` | Reads the game's own block textures out of the installed game once, into `data/claude_player/sight-cache/` (not in git). |
| `actions.mjs` | What can be asked for over the control port besides player.mjs's own commands (`look`, `score`). Loaded again when it changes, so a new command needs no restart. |
| `score.mjs`, `challenge.json` | The challenge with Codex's player, and its score counted from the server's log. |
| `skills/*.mjs` | One small file per thing the player can be asked to do. |
| `pure.mjs` | Small functions with no game connection. |
| `../tests/claude_*.test.mjs` | 44 tests: the planner played from empty hands to an iron pickaxe; the reflex rules held against the situations that killed the player; the room's way out; what was really said in chat read for what it asked; the score; the eyes on a made-up world. |
| `journal/` | A copy of the journal, the memory and the advancements as they stood when this was written. The live ones are in `../data/claude_player/`, which is not in git. |

What reloads when its file is saved, with the player still running: `brain.mjs`,
`planner.mjs`, `reflexes.mjs`, `lib.mjs`, `chat.mjs`, `actions.mjs`, `eyes.mjs`, `sight.mjs`,
`score.mjs` and everything in `skills/`.
What needs the player restarted: `player.mjs`, and `pure.mjs` (the others import it once).

## The eyes

CT, 2026-10-04: "enable your avatar in world to 'see' things and 'take a look' at something
in game. you should be able to produce a screenshot of the perspective of your agent at any
time, and use these screenshots to help you make decisions in-game".

`node claude_player/player.mjs look` gives a 640 by 360 picture from the player's eye, in
about a second, at any moment: in the middle of a skill too, because nothing is sent to the
server and no game client is opened. The player's process casts one ray for each dot through
the blocks the server has sent it, with the game's own textures (read from the copy of the
game installed here; flat colours without it), the light the server sent, and a lamp of its
own so that a mine can be seen. Creatures and players are boxes with their names and how far
they are. On the picture: where it is, which way it faces, the hour, health, what it holds,
and what is under the middle of the view.

Every look also comes back as words and numbers (`says`, `told`, `seen`): how much of the
view each block fills, what is straight ahead and how far, the nearest ore, water, lava,
chest and the like with its side of the view, and the creatures in view. That is what the
player's own program, and its chat answers ("what do you see?"), use. The session reads the PNG.

How it is known to be right, and how to check it again:

- `tests/claude_sight.test.mjs` draws a made-up world: the wall at its true distance, east on
  the right when facing north, a slab at half height, a creature hidden by a wall. A mirrored
  camera and a camera upside down were each planted and each turned tests red.
- Every plain look asks the game library's own ray, at the same moment, which block is under
  the middle of the view, and reports `agrees`.
- `look '{"at":"north","check":1500}'` puts 1,500 dots of the picture to the library's ray,
  block and place both. Standing still at 08:39 on 2026-10-04: 8,985 of 9,000 over six views,
  each miss the neighbouring block at an edge. With `"plant":"shift"` (the world drawn one
  block out of place on purpose) 232 of 1,500. The first version of this check compared names
  only and passed the planted fault 1,500 times in 1,500, in a tunnel where everything is tuff.

What it does not draw: arms and what is held, particles, clouds, rain, the shapes of
creatures, chests and signs as the game models them (they are boxes with a plank texture).
Water is a tint. It shows what the server has told this player, which is what it can know.

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
- "look up ideas online for how to create a persistent bot that plays the game and
  periodically reports to you for decisions, and you use the data to strategically write new
  code and performa maintenance on existing systems in the program. I want it to compete with
  Codex and for Codex to compete with you. You both can communicate with one another in the
  game chat" (2026-10-04)
- "read the game chat and respond accordingly" (2026-10-04)
- "enable your avatar in world to 'see' things and 'take a look' at something in game. you
  should be able to produce a screenshot of the perspective of your agent at any time, and
  use these screenshots to help you make decisions in-game" (2026-10-04)
- In the game, as fogsift: "Claude can you build a bigger base?" (06:17 on 2026-10-04; the
  player took it for small talk and the session did not see it until 07:45. Not built yet.)
  "What do you guys think about doing some cleanup today?" and "I was thinking we could
  flatten the surrounding area and prepare to get some crops going" (07:38. Not started yet.)

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
- **Other programs edit this folder too.** On 2026-10-04 another session changed `chat.mjs`
  twice so that the player would know Codex's player by its new name. The first of those
  edits was lost when a rebuilt `chat.mjs` was moved into place over it. Before replacing a
  file here, look at `git status -- claude_player` and the file's time, not only at git's last commit.
- **The world can be restarted under the player** (08:33 on 2026-10-04). The player comes back
  by itself. The server's log starts again, and the morning's lines are then in
  `logs/2026-10-04-1.log.gz`: `score.mjs` reads both.
- **A check that compares names is blind where everything has one name.** See "The eyes".
- **The Tab board reads `status`.** Another session's `tools/tab_board.mjs` shows CT what
  `player.mjs status` returns (health, doing, thought, lastSkill, deaths). Keep those fields.
- **`bot.wake()` is broken for this game version.** The library sends a number where 26.1
  wants the name `stop_sleeping`. `lib.mjs getUp()` sends the name.
- **The world's spawn point is in a treetop**, and a bed only holds the spawn point if it has
  been slept in since it was last put down.

## Score, from the server's logs, at 08:50 on 2026-10-04

12 advancements for `Claude`: Stone Age, Getting an Upgrade, Monster Hunter, Acquire
Hardware, Isn't It Iron Pick, Suit Up, Sweet Dreams, A Seedy Place, Diamonds!, Voluntary
Exile, Cover Me with Diamonds, Not Today, Thank You. Codex's player (`CodexAstra`, and
`Codex` since 08:00:51) has 4 in the log, and fogsift 5.

21 deaths: 12 to zombies, 4 drowned, and one each to a spider, a cave spider, a skeleton, a
creeper and a magma block. NOTES.md has each one and what it changed. None since 04:32:03.
Codex's player has died 31 times and fogsift 16.

The challenge (`challenge.json`): since 08:00 on 2026-10-04, one point for each new
advancement and minus one for each death. At 08:50: Claude 0, Codex minus 1.
`node claude_player/score.mjs` says what it is now.

## What is next

`asks.json` has what has been asked for and is not done: a bigger base, cleanup and crops
with fogsift and Codex's player, and staying in reach of the bed at night. Those come first.
REVIEW.md has what is left of the review. Beyond it, in the order they look worth doing:
a way into the base that stays (stairs and a door), Hot Stuff (a bucket of lava, with great
care: lava is what would take the diamond armour for good), The Parrots and the Bats (the
goal is in and has not met two chickens yet), string for a bow and a fishing rod.
