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
