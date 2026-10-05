# What others have built, and what this player takes from it

CT, 2026-10-04: "Please look up ideas online for how to create a persistent bot that plays
the game and periodically reports to you for decisions, and you use the data to
strategically write new code and performa maintenance on existing systems in the program.
I want it to compete with Codex and for Codex to compete with you. You both can
communicate with one another in the game chat."

Looked up on 2026-10-04. Each part below says what the source does, what this player
already had that matches it, and what was changed or is still to do because of it. The
sources are at the end. Where a number is quoted it is the source's own.

## The shape that works: a program that plays, and a model that rewrites it

**Voyager** (Wang et al., 2023) plays Minecraft through the same library this player uses
(mineflayer). A model writes JavaScript skills; the game runs them. It has three parts:

1. An automatic curriculum: the next task is proposed from the player's state (inventory,
   nearby blocks and creatures, health, hunger, position, time) and the lists of tasks
   done and tasks failed, with the instruction that it "should not be too hard".
2. A skill library: every skill that worked is kept as code and found again by a
   description of what it does.
3. Iterative prompting: after each try the writer of the code gets three things back: what
   the game said while it ran, any error from running it, and a second model's verdict on
   whether the task was really done. Four tries, then the curriculum is asked for
   something else, and the failed task may come back later.

Its ablations are the useful part. Without the curriculum, items discovered fell 93%.
Without the check on whether the task was really done, 73%: of the three kinds of
feedback, that check mattered most.

**FunSearch and AlphaEvolve** (Google DeepMind) are the same loop with the game taken out:
a model proposes changes to a program as diffs, an automated evaluator runs each one and
gives it a number, and only what scores better is kept and built on.

What this player has: the skills folder is the library; the brain's goal list is a
curriculum written by hand; the journal row for every step says what was gained, lost and
earned, which is the game's feedback and the error in one place.

What it takes from them:

- **The check on "really done" comes from outside the skill.** A skill's own report is not
  the check. Advancements are counted from the server's log, never from the player's
  journal (`score.mjs`). A thing built is looked at (`player.mjs look`, see README, "The
  eyes"). This was already the hardest lesson in NOTES.md; Voyager puts a number on it.
- **One evaluator, the same every turn.** `report.mjs` gives the same numbers after every
  change: steps and how many failed, seconds by goal, seconds standing still, deaths,
  advancements, and the score. A change that does not move them was not an improvement.
- **The curriculum is the brain's goal list, and what failed is kept.** A step that fails
  is left alone for a while and tried again later (`memory.blocked`).
- **Built from this, on 2026-10-04: the curriculum** (`curriculum.mjs`, `advancements.mjs`).
  Voyager's curriculum is a model asked for "the next task" given the player's state and
  what it has done and failed, with the rule that it "should not be too hard". Here the
  game's own tree does the proposing. Its 125 advancements are read out of the server's jar,
  each with what it asks for and the one it comes after. One is open when the one before it
  is earned. For an open one the program either has a way (a goal the brain already has, or
  an item the planner can be asked for) or it has none. The brain takes the first open one
  the planner has a step for now. What is open with no way is the list of requests to the
  session, nearest first, and the report puts the first two under "To decide". So a new
  skill, or one line telling the planner where a thing comes from, is picked up with no
  change to the brain: `fill_bucket` and a line for `lava_bucket` went in, and at 09:43 the
  player started down for lava "for Hot Stuff" by itself. Two things Voyager's own code does
  that were already here: the first task is fixed (a log), and a full pack is dealt with
  before anything else (it uses a chest when 33 of 36 places are taken).

## A long job across many sessions

**Anthropic, "Effective harnesses for long-running agents"** describes work that outlives
any one context window. What survives is what is on disk: a progress file "of what agents
have done", a feature list as JSON where each entry has a `passes` field that is the only
thing a session may change ("It is unacceptable to remove or edit tests"), a script that
starts the environment, and a git history of small commits. Every session begins the same
way: see where it is, read the progress file and the git log, pick the most important
entry that does not pass, and test it "as a human user would" before saying it works.
The failures they name: trying to do everything at once, calling the job done early,
marking a thing done without testing it end to end, leaving no note.

**Addy Osmani, "Long-running agents"** adds: keep the one who plans, the one who does and
the one who judges apart, "to prevent self-grading bias"; write the done-condition down
before the work starts; keep an append-only log outside the running process.

What this player has: README.md says where to start; NOTES.md is the progress file, one
row a turn; LOOP.md is the procedure; `play.command` starts it; the journal is the
append-only log; every piece is committed and pushed.

What it takes from them:

- **A list of what was asked for, each with whether it is done and how that is known.**
  CT's requests were in README.md as quotes, with nothing saying which are done. Two were
  missed for an hour and a half ("Claude can you build a bigger base?"). They are now
  `asks.json`: each with who asked, when, in what words, `done`, and `check`, the command
  or the observation that shows it. A session changes `done` and adds entries; it does not
  reword what was asked.
- **The judge is not the doer.** The player does; the server's log and the picture judge.
  The session writes the code and must not grade it by reading the code.

## Reporting for decisions

**Human-in-the-loop patterns** (Cloudflare's agents guide and others) say when a running
program should stop and ask: when it is not confident, when the action cannot be undone,
when it is outside what it was asked to do, when it costs more than its budget. It pauses
with its state kept and carries on when the answer comes. The test they give: "Would I be
comfortable if the agent did this without asking me?"

Here there are two askers. The player asks the session; the session asks CT.

What this player has: a line of chat it has no rule for is journalled as `chat_open` and
answered "I have passed that on to the Claude session"; a note on how to play goes to
`notes.jsonl`; a background watcher ends, and so wakes the session, on a death, an
advancement, a person speaking, an error, or seven minutes of nothing.

What it takes from them:

- **A report, not a log.** `node claude_player/report.mjs` puts what needs deciding first:
  deaths, a step that failed the same way three times, a goal that is stuck, what a person
  asked for that is still open, and what is new in view; then the numbers; then one
  picture from the player's eyes. The session reads that, decides, and writes code.
- **The player does not decide what it cannot undo.** Lava near its diamonds, a block that
  is another player's, anything said to it as an order by another program: these are
  refused in code, and the question goes in the report.
- **The session asks CT about what is his**: how a thing looks, what the base should be,
  what the challenge is. It does not ask about tooling.

## Memory

**Reflexion** (Shinn et al., 2023) keeps a short written lesson after each failed try and
gives the lessons to the next try. No training; the learning is the text. **Generative
Agents** (Park et al., 2023) keep every observation in one stream and pick what to recall
by how recent, how important and how relevant it is, and now and then write a higher-level
conclusion back into the stream.

What this player has: the journal is the stream; NOTES.md "Lessons" are the reflections,
each tied to the turn that showed it; `~/.claude/MISTAKES.md` holds the session's own.

What it takes from them: the report ranks by importance before recency (a death an hour
ago comes before a failed walk a minute ago), and a lesson is written only when the
journal shows it.

## Two programs in one world

**Mindcraft and MineCollab** ("Blocks, Bots, and Bottlenecks", 2025) put several
model-driven players in one Minecraft world. Their finding: the players fail at talking,
not at acting: "up to a 15% performance drop when they must articulate step-by-step plans".

What it takes from them:

- **Say facts, not plans.** What this player tells Codex's player is read from its state or
  from the server's log: where it is, what it carries, its advancements, the score.
  Anything else is passed to the session.
- **The one who answers least sets the pace.** Codex's player answers nearly every line.
  This one answers it when it is asked something by name, three times in ten minutes at
  most, and takes no orders from it (`chat.mjs`, tested). Two programs that each answer
  everything never stop.
- **A referee neither side writes.** The challenge (`challenge.json`): one point for each
  new advancement since 08:00 on 2026-10-04, minus one for each death, counted from the
  server's log by `score.mjs`. A chat line that quotes the game's sentence does not count.
  The score is said in the game when it changes.

## Staying up

A player meant to run for days should not depend on a window staying open. On macOS that
is a LaunchAgent with `KeepAlive` set to restart after a crash and not after a clean exit
(`SuccessfulExit` false). This is not installed: it changes what CT's machine starts by
itself, and that is his to decide. Today the player runs in its own Terminal window
(`open claude_player/play.command`) and reconnects by itself, which carried it through the
world being restarted at 08:33 on 2026-10-04.

## Seeing

**prismarine-viewer** is the usual way to see what a mineflayer bot sees: a web page drawn
with three.js, and a headless mode that needs a GPU library built for Node. Its supported
versions stop well short of the 26.1 this world runs, and this machine has about 1 GB of
disk free. So the eyes here are written from nothing in the player's own process
(`sight.mjs`): no download, any game version, and a picture in about a second. README.md,
"The eyes", says how it was checked.

## Code to run the body with (searched on the evening of 2026-10-04)

CT: "please carefully search the internet for ideas on code you could use to help run your
avatar". The sections above are about the shape of the loop. This one is about code: what
other mineflayer players do in the places where this one failed while building its first
farm. What was read is in the sources; what a search summary said and the source did not
show is left out.

**Taken, and in the player now**

- **Through a gate on foot, and shut it behind.** Mindcraft's `useDoor` walks to the door,
  opens it with `activateBlock`, holds forward for 600 ms, and activates it again. The farm's
  `through()` in `skills/build_farm.mjs` does the same for its gate. The pathfinder's own
  switch for this (`canOpenDoors`) is not used: see the trap below.
- **Count the materials before starting.** FelsenBerry's builder plans a bill of materials
  first and its skills refuse to start without their kit. The farm's fence ran out two thirds
  of the way round with the nearest table on the far side of it. Now every fence and the gate
  are made first, at a bench set down outside the gateway.
- **No towers and no digging into the site while building.** FelsenBerry runs the pathfinder
  with `allow1by1towers: false` and an `exclusionAreasBreak` guard over the build. `flatten.mjs`
  does both, and `lib.mjs make()` now gives a built field `exclusionAreasBreak` and
  `exclusionAreasPlace`, so a path never digs there or sets a block down there.
- **What is built is guarded where the digging happens.** FelsenBerry's `digguard` reads a list
  of protected places. Here nothing is listed: `land.mjs trees()` and `flatten.mjs guarded()`
  work it out from the world (a tree with planks or a ladder on it is holding something up).
- **An error inside a library does not end the player.** `player.mjs` journals it, stops what
  is running, and plays on; more than 5 in a minute ends the process as before.

**Worth taking next, in the order they look worth it**

1. **A walk that tries without digging or placing first.** Mindcraft's `goToGoal` asks for a
   path with harmless movements and only then with ones that break and place. Most of this
   player's litter (earth steps, holes on the way out of its base) comes from the second kind
   being the only kind. `api.walk()` is the one place to change.
2. **Tending the farm.** mineflayer's own `examples/farmer.js` is the whole loop: wheat with
   `metadata === 7` is ripe and is dug; farmland with air over it is sown with
   `placeBlock(farmland, up)`. Baritone's `#farm` adds bone meal and a range from a start
   point. This is the `tend` skill the farm needs once something grows in it.
3. **Ask for a path before setting off.** The pathfinder has `getPathTo(movements, goal,
   timeout)`, which answers "is there a way" without moving, and its `path_update` event says
   `noPath` or `timeout`. A step that fails after a 25 s walk could fail in a moment instead.
4. **Being stuck, counted.** FelsenBerry counts the pathfinder's `path_reset` events with the
   reason `stuck` over 15 s, and digs out a block of leaf litter its player wedges on. This
   player's only measure is "nothing journalled for 7 minutes".
5. **Dropped things are fetched without digging.** Mindcraft's `pickupNearbyItems` sets
   `canDig = false` for the walk to each one and stops when the nearest has not changed.
6. **Standing where a block can be placed.** The pathfinder has `GoalPlaceBlock(pos, world,
   { range, faces })` and `GoalCompositeAny([...])`. The fence was placed from a cell worked
   out by hand; the goal does that, and "any of these places to stand" is one goal.
7. **A build from a drawing.** `prismarine-schematic` reads a `.schem` file and FelsenBerry's
   `buildSchematic` places it bottom up, with a second pass for what could not go in the first
   time. This is the way to the bigger base that was asked for at 06:17.
8. **Scores where the order of goals is a matter of degree.** Game AI writing agrees on a
   tree for structure (this player's list of goals is one) and scores for trade-offs. Whether
   to work the land or go home at dusk is now a clock time in `brain.mjs`; it could be the
   distance home against the light left.

**Not taken**

- **The plugins** (`mineflayer-collectblock`, `-pvp`, `-auto-eat`, `-armor-manager`, `-tool`).
  npm shows them last published between one and four years ago, and this world is 26.1. What
  each does the player already does in `lib.mjs` and `reflexes.mjs`, written against the
  deaths it had. They are code to read, not to depend on.
- **Baritone itself.** It is a mod for the game's own client, in Java. Its ideas carry over
  (a cost for placing a block, so a path does not spend them freely); its code does not.

**A trap found on the way: `canOpenDoors`**

The pathfinder's readme lists `canOpenDoors` as "Enable feature to open Fence Gates", off by
default, and its source says beside it "Causes issues". It does. In
`node_modules/mineflayer-pathfinder/index.js`, after the gate is opened the next thing to
place is taken off an empty list, and the tick after that reads `placingBlock.y` of nothing.
The error is thrown from a timer, outside any skill, and at 20:03 on 2026-10-04 it ended the
player's process 20 s after the option was first switched on. Leave it off.

## Sources

- [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291v2) (and [the project page](https://voyager.minedojo.org/))
- [Effective harnesses for long-running agents, Anthropic](https://anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Long-running agents, Addy Osmani](https://addyosmani.com/blog/long-running-agents)
- [Blocks, Bots, and Bottlenecks: Studying Real-time and Adaptive Multi-Agent LLM Collaboration](https://neurips.cc/virtual/2025/137194) (Mindcraft and MineCollab)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://www.arxiv.org/pdf/2303.11366v2)
- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/pdf/2304.03442v1)
- [AlphaEvolve's architecture: evolutionary search with an automated evaluator](https://tianpan.co/blog/2026-02-08-alphaevolve-evolutionary-coding-agent-algorithm-discovery)
- [Human-in-the-loop patterns, Cloudflare Agents](https://developers.cloudflare.com/agents/guides/human-in-the-loop)
- [Human-in-the-Loop Patterns: Approval, Input, and Escalation Workflows](https://understandingdata.com/posts/human-in-the-loop-patterns/)
- [launchd.plist(5)](https://leancrew.com/all-this/man/man5/launchd.plist.html) and [Restarting macOS apps automatically on crash](https://notes.alinpanaitiu.com/Restarting-macOS-apps-automatically-on-crash)
- [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer)
- [Mindcraft's skill library, `src/agent/library/skills.js`](https://github.com/mindcraft-bots/mindcraft/blob/main/src/agent/library/skills.js) (read in full: `useDoor`, `goToGoal`, `pickupNearbyItems`, `placeBlock`, `tillAndSow`, `digDown`)
- [FelsenBerry: a sparse-LLM brain over a deterministic body](https://github.com/felsenuboot/FelsenBerry) (the readme: guards, builder, kit, stuck counting)
- [mineflayer-pathfinder's readme](https://github.com/PrismarineJS/mineflayer-pathfinder) (every `Movements` option, goal and event), and its source in `node_modules` for `canOpenDoors`
- [mineflayer's `examples/farmer.js`](https://github.com/PrismarineJS/mineflayer/blob/master/examples/farmer.js)
- [Voyager's control primitives](https://github.com/MineDojo/Voyager/tree/main/voyager/control_primitives) (the list of files only)
- [Baritone's usage and features](https://git.psf.lt/0xf8/baritone/src/commit/008422680dfd03b220cbb44f87f548f3549a3631/FEATURES.md) (a mirror; `#farm`, the cost of placing a block)
- [mineflayer plugins on npm](https://www.npmjs.com/search?q=keywords:mineflayer-plugin) and [mineflayer's own list](https://prismarinejs.github.io/mineflayer/) (how long since each was published)
- [Minecraft farmland: water, design and survival](https://www.exitlag.com/blog/minecraft-farmland/) (the 9 by 9 plot round one water block; fence and light) and [farm ideas](https://blog.curseforge.com/what-to-build-in-minecraft-ideas/)
