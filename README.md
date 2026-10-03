# gameplay_iterator_benchmark

A game-agnostic harness where a small local model plays a game on one machine, one logged
run at a time, and gets better between runs. The model's weights never change. What changes
is its playbook: the advice it reads and the skills, written as code, that it chooses from.
Claude writes the next playbook after reading each finished run. Minecraft is the first
real game.

- [docs/report.html](docs/report.html): the report. What exists, how it works, what was learned, what comes next.
- [notes/](notes/README.md): the roadmap, the standing rules, and what each session found.
- [docs/loop.html](docs/loop.html): the first results on the test game, with a replay of two real runs.
- [docs/plan.html](docs/plan.html): the original proposal. Parts of it are out of date; this README is current.

## What is built (2026-10-02)

| Part | State |
| --- | --- |
| Runner: reset from a seed, play to a budget, record why the run ended | Built and tested |
| Database (SQLite) plus one JSONL log per run, with decision timings and the options offered | Built and tested |
| Replay a stored run; diff two runs step by step | Built and tested |
| Local model as the player, through llama.cpp | Built; run for real on the testbed |
| Skills and versioned playbooks | Built and tested |
| Claude as coach: scores a run, writes the next playbook, which must pass validation | Built; run for real twice |
| Testbed game, the harness's own fixture | Built and tested |
| Runtime fetch: Java 25, Minecraft 26.1 server, two models | Built; fetched and verified on this machine |
| Minecraft adapter: a server from one seed, a bot that joins, observes and acts | Built; run for real |
| A game window to watch a run in (`tools/watch_client.mjs`) | Built; the launch itself is not yet tested |
| Vault notes written by the local model | Not built |

## First results

One world of the testbed game (seed `sim-1`), 40 decisions allowed, measured on a 2015
Intel MacBook Pro.

| Run | Model | Playbook | Ended | Decisions | Options each | Median decision |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | Qwen3.5-0.8B | v001, no advice | died | 8 | 4 | 4.6 s |
| 6 | Andy-4.2-Micro | v001, no advice | died | 8 | 4 | 5.4 s |
| 5 | Qwen3.5-0.8B | v002, by Claude | finished | 6 | 1 | 5.6 s |
| 7 | Andy-4.2-Micro | v002, by Claude | finished | 6 | 1 | 6.2 s |
| 9 | Qwen3.5-0.8B | v003, by Claude | finished | 6 | 6 | 7.9 s |
| 10 | Andy-4.2-Micro | v003, by Claude | finished | 8 | 6 | 6.7 s |

What this shows: the loop works. The same model in the same world went from dying with
nothing to finishing in the fewest decisions possible, because of a playbook Claude wrote
from the stored run. All 48 model decisions were valid options.

What it does not show: it is a toy game and one world. Most of the skill is in the code
Claude wrote; v002 offered the model a single option every time, which is why the coach now
has a rule against that. Decisions took 4.6 to 7.9 seconds, which is not real time: this
model family cannot reuse the unchanged part of a prompt on the llama.cpp build used, so it
reads the whole prompt (376 to 574 tokens, at about 97 tokens a second) every turn.

## Run it

Needs Node 22.13 or newer. `npm install` is only needed for the Minecraft bot library.

```sh
npm test                                  # every check, including planted faults that must be caught
tools/fetch_runtime.sh                    # Java 25, the Minecraft 26.1 server, two models: 1.2 GB into runtime/
./iterate.mjs run                         # one run, scripted random player, latest playbook
./iterate.mjs run --player llama          # one run with the local model choosing
./iterate.mjs coach 4                     # hand run 4 to Claude; it may write the next playbook
./iterate.mjs loop --runs 3 --player llama   # run, coach, run again: three runs
./iterate.mjs replay 4                    # play run 4 again from the database and check every step
./iterate.mjs compare 5 7                 # the first step where two runs differ
./iterate.mjs runs                        # list the stored runs
```

Runs are stored in `data/benchmark.sqlite` and `data/runs/`. `data/` and `runtime/` are not
in git. Paths that belong to one machine go in `config.local.json`, also not in git:

```json
{ "llamaServer": "/path/to/llama-server", "claude": "/path/to/claude", "coachModel": null }
```

The coach needs Claude Code 2.1.251 or newer.

## Layout

```text
iterate.mjs               the command line runner
config.json               which game a run uses, and the default model file
harness/                  everything shared by every game
  adapter.mjs             the contract a game must meet
  runner.mjs              one run, start to finish
  store.mjs               the database and the JSONL logs
  replay.mjs              replay a run, compare two runs
  skills.mjs              playbooks: load skills.js in a sandbox, put skills in front of a game
  coach.mjs               hand a run to Claude, validate and adopt the playbook it writes
  players/llama.mjs       the local model as the player
  players/scripted.mjs    players that are plain code: a floor to compare a model against
games/testbed/            a tiny seeded grid game that exists to test the harness
playbooks/<game>/vNNN/    every playbook version: briefing.md and skills.js
tests/                    run with npm test
tools/fetch_runtime.sh    fetch and verify the runtime files
```

Nothing in `harness/` may import from `games/`, and a test enforces it.

## A game adapter

A game is `games/<name>/adapter.mjs`, exporting `createAdapter()` and
`defaults = { seed, budget }`. The harness calls only these:

| Member | What it does |
| --- | --- |
| `name`, `version` | Which game and which build of it; stored on every run |
| `reset({ seed, options })` | Put the game in its known start state for this seed |
| `observe()` | What the player can see now, as plain JSON |
| `actions()` | The actions possible now: `[{ name, about }]` |
| `act(action)` | Apply `{ name, args }`; returns `{ result, events }` |
| `tick()` | Game time, an integer that never goes backwards |
| `ended()` | `null` while the game goes on, or the reason it stopped |
| `metrics(log)` | Numbers for a finished run, worked out from its steps and events |
| `describe()` | The rules in words, for the model and the coach |
| `vocabulary()` | Optional: every action the game has, for the coach to write skills with |
| `close()` | Release whatever `reset()` started |

## Playbooks, skills and the coach

A playbook is `playbooks/<game>/vNNN/`: `briefing.md`, which the model reads before every
decision, and `skills.js`, the commands it chooses from. A skill is code that does one job
using the game's own actions. The exact rules for writing `skills.js` are in
`SKILLS_CONTRACT` in [harness/skills.mjs](harness/skills.mjs).

`skills.js` runs in a sandbox with no `require`, `import`, `process` or network. That keeps
accidents out. It is not a security boundary, so only run playbooks you trust.

When a run ends, `./iterate.mjs coach <run>` sends Claude the rules, the current playbook
and every decision of the run: what the model saw, its options, its choice, and the
result. Claude replies with a score, its reasons, and a new briefing or `skills.js`. A new
playbook is adopted only after it loads and plays three test worlds without a skill
crashing; a rejected one goes back to Claude once with the reason. The verdict is stored
in `evaluations`, and the new version in `skill_versions` with the run that caused it.

Claude is called with nothing loaded but the question: no tools, no MCP servers, no
settings. Without that, one call carried 245,454 tokens of the machine's Claude setup;
with it, 668.

## What makes two runs comparable

Every run stores its inputs: game, game version, seed, options, code commit (marked
`+dirty` when the tree has uncommitted changes), player, model file hash, playbook version
and budgets. A hash chained over the steps, `trace_hash`, stands for the whole run: the
same inputs give the same hash. `replay` plays a run's stored choices again and names the
first step that differs.

Seeds are text everywhere, because a Minecraft seed is a 64-bit integer that a JavaScript
number cannot hold exactly.

A run ends by `budget_ticks`, `budget_calls`, a reason the game gives (the testbed gives
`death` and `complete`), or `error`. A crashed run keeps its steps and is never recorded as
finished.

## The database

| Table | Holds |
| --- | --- |
| `runs` | One row per run: its inputs, why it ended, its step count and trace hash |
| `steps` | Per decision: tick, observation, options offered, choice, result, model response, decision and action time |
| `events` | What happened during a step: items, milestones, damage, death |
| `metrics` | Named numbers per run, from the harness and from the game |
| `evaluations` | The coach's score, reasons and outcome for a run |
| `skill_versions` | Each playbook version, its parent, and the run that led to it |

## Minecraft

Minecraft 26.1 is the version because it is the newest that Mineflayer 4.39.0 lists as
tested. It needs Java 25. A game can only join a server of its own version, so watching a
run needs a 26.1 installation in the launcher.

Each run deletes the world and makes it again from one seed, `7040093665601660210`, so
every run starts on the same land (the bot has spawned within about 15 blocks of the same
spot, in a forest with stone and coal nearby). The server is bound to this machine only and
runs in offline mode so a bot can join. It will not start until its owner accepts Mojang's
EULA in `runtime/minecraft-server-26.1/eula.txt`. Runs are played in real time: the world
keeps moving while the model thinks, and mobs are the server's own dice, so two runs start
alike and then differ.

The game's own actions are whole jobs: `collect:<block>` (walk to the nearest one within
reach of the ground and dig it), `craft:<item>`, `place:crafting_table` and
`explore:<direction>`. Skills in the playbook combine them.

| Run | Player | Playbook | Decisions | What happened |
| --- | --- | --- | --- | --- |
| 12 | Andy-4.2-Micro | v001, raw actions, no advice | 25 | Chose `collect:oak_log` 25 times. 21 logs, nothing crafted, fell out of trees three times. |
| 13 | Andy-4.2-Micro | v002, written by the automatic coach | 25 | Chose `explore:north` 25 times and walked 511 blocks away from the forest. Nothing achieved. |
| 17 | scripted, first option | v003, written by hand | 9 | Stone pickaxe in 7 decisions. |
| 18 | Qwen3.5-0.8B | v003, written by hand | 14 | Stone pickaxe in 7 decisions, 77 seconds of game time, no damage, 3.3 s median per decision. Then only `explore` was left on the menu. |
| 20 | Qwen3.5-0.8B | v003 | 22 | A bad spawn, on a hill at y 83 with no stone in reach. Stone pickaxe only at decision 16: it lost sight of its table, crafted a second, and timed out walking back three times. Ended `error` at decision 22 from a reused connection. Three adapter fixes came from this run. |
| 21 | Qwen3.5-0.8B | v003 | 14 | Played with a game window attached and watching. Stone pickaxe at decision 8, after one `explore` because no stone was in reach; 149 seconds of game time, no damage, 4.5 s median per decision. |
| 23 | Qwen3.5-0.8B | v003 | 25 | 8 milestones, stone pickaxe at decision 8, 3 fall damage, then `explore:north` 16 times. |
| 22 | Qwen3.5-0.8B | v004, written by hand | 25 | 11 milestones: stone pickaxe at decision 7, then iron, coal and a furnace by decision 13. No damage. |
| 24 | Qwen3.5-0.8B | v004 | 16 | 11 milestones, furnace at decision 14, 3 damage. |
| 25 | Andy-4.2-Micro | v004 | 16 | 11 milestones, furnace at decision 12, no damage. |

What that shows: with raw actions or a long briefing, these 0.5 GB models repeat one
command for a whole run. v003 and v004 work because each skill is a whole job and the menu
lists only what is useful now, most useful first. Most decisions have one or two options,
so these runs show the loop working more than they show the model's judgment.

v003 and v004 were written by a Claude in chat reading the database, not by the automatic
coach. That costs nothing beyond the chat, and it did better: the one automatic rewrite
(v002) made things worse. Runs 23 and 22 are a fair pair on the same code and budget.
Things to know when reading the numbers: the pathfinder digs its own way through terrain,
so cobblestone, dirt and sometimes coal are picked up without being chosen; and every v004
run lost about 75 seconds walking back up to its crafting table after mining down. The
adapter now lets a second table be placed near the bot, which the next playbook can use.

To watch in a game window: `tools/watch_client.mjs fetch` keeps its own 26.1 copy of the
game under `runtime/client-26.1/` (82 MB beyond what a launcher with a newer version already
has), and `--window` on a run opens it already joined to the server as a spectator.

`tools/play.command` and `tools/download_game.command` open a Terminal window and show a run,
or the download, live.

## Credit

Andy-4.2-Micro is by the Mindcraft CE team, under the Andy 2.0 License. This work uses
data and models created by @Sweaterdog, and the Mindcraft Project.
