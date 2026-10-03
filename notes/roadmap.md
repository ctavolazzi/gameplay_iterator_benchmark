# Roadmap

Written 2026-10-03 from CT's direction that day. The aim, in his words: the same seed, the
same world, start from zero, and iterate until the scripts improve and the AI can build a
house, a bed, and pursue the rest of the achievements Minecraft offers, all the way up to
beating the game, eventually. It should look like a person playing, and feel like "our own
AI mob": deterministic code that reacts to the game in real time, with a local model
guiding its decisions.

Each phase says what "done" means, so it can be checked and not argued.

## Phase 1: play through the real game window (in progress)

The hidden bot has no screen, so its inventory can never be shown. The real window, driven
by keys and mouse (`tools/hands`), shows everything.

- Built and played on 2026-10-03 (`--body hands`; see
  [2026-10-03-real-window.md](2026-10-03-real-window.md)): the player follows a planned path
  with W held, fells a tree from the ground, digs by holding the mouse, picks up drops,
  crafts by clicking in the real inventory and crafting table, and puts a table down.
- A silent helper bot, a spectator named Eyes, supplies what the screen cannot: the blocks
  around the player and a planned path.
- While the model thinks, the inventory is open. On damage it closes. What the body then
  does about the damage is phase 2.
- The game window stays open between runs and rejoins the new server by itself.
- Both bodies take the same action names, so one playbook serves both.
- The player reads its own screen to know whether an inventory is showing.

Done when: a stone pickaxe is reached through the real window, on video, with the
inventory and crafting table screens visible.

## Phase 2: reflexes

A layer of plain code that runs many times a second with no model call.

- Health drops: close any menu, find the cause, flee or fight.
- Hunger: eat. Night: shelter or light. Water, lava and falls: get out.
- Every encounter is stored: what started it, what was done, how it ended.

Done when: a run survives a night, and the database can answer "how many encounters, how
many won".

## Phase 3: the game's own achievements as goals

The server log already prints lines such as `LocalModel has made the advancement [Stone Age]`.

- Read those lines into events, so the game itself is the judge.
- Each run aims at one advancement. After reaching it, the run plays on freely to gather
  what the next playbook needs.
- First goals outside the advancement list: a shelter with a door, and a bed.

Done when: runs are started with a named goal, and the results table is in advancements.

## Phase 4: the corpus

- Per run: decisions, options, model answers, skills called, the game's actions inside
  each skill, errors, encounters, advancements, timings, playbook and code version.
- Per skill: how often it is chosen, how often it fails, and why.
- A note per run in `notes/runs/`, and a page generated from the database.

Done when: a stranger can clone the repository, read the notes, and say why run N did
better than run N minus 1.

## Phase 5: coaches and brains compared

- Coaches: give two Claude models the same stored runs and the same starting playbook, and
  compare what their next versions achieve. Later, a local model as coach.
- Brains: the same playbook with different local models.
- Then widen the menus a step at a time, to find where a small model's judgment holds.

Done when: there is a table of coach against result and brain against result, each from
more than one run.

## Phase 6: the long road

Iron tools and armour, a farm, diamonds, the Nether, the End. A second game through a
second adapter.

## Known weak spots

- Most decisions have one or two options. The playbook steers; the model follows.
- One seed. Nothing here is known to hold on another world.
- Runs are played in real time, so two runs from the same seed differ once mobs act.
- The pathfinder digs through terrain, so cobblestone and dirt are collected unasked.
- `games/minecraft/adapter.mjs` still carries its own copies of constants that now live in
  `games/minecraft/common.mjs`. They should be one.
