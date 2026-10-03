# The real window learns to play (2026-10-03, second session)

What this session set out to do, from CT: make the game look played by a person. The
inventory opening and closing, the swing of a tool, the same seed every time, and the game
window left open between runs.

## What works, and how it was checked

Every line here was checked against the server's own record of what the player carries
(`data get entity LocalModel Inventory`), not against what the program believed it had done.

| What | Checked by |
| --- | --- |
| Walk to a tree and fell it from the ground | `oak_log` count rising 1, 2, 3 at ground level (y 69) |
| Pick up what a dug block leaves behind | `cobblestone` 1 to 6 over six digs, `coal` 1 |
| Craft in the real inventory screen by clicking | `oak_planks` 4, 8, 12, then `stick` 4, then `crafting_table` 1 |
| Put the table down and craft at its own screen | table gone from what is carried, then `wooden_pickaxe` 1 |
| Inventory open while "thinking" | a picture of the window, taken mid-think |
| The game's own advancements arrive as events | `Stone Age` at the first cobblestone |
| The window stays open and rejoins by itself | in the world 40.6 s after start, against 58.7 s when opened new |

The test tool is `tools/hands_stage.mjs`: it plays named actions one at a time with no
model, prints the result and what is carried, and saves a picture of the window after each.

## The two whole runs

| Run | Brain | Result, from the database |
| --- | --- | --- |
| 33 | none (first option each time) | All 11 milestones by decision 6, tick 6280. No damage. |
| 34 | Qwen3.5-0.8B | All 11 milestones by decision 6, tick 8880. No damage. Median decision 6.6 s. Filmed: 482 seconds, 23,013 frames. |

Both played `v005s`, the playbook written for the hidden bot, with no change. Run 34's video
is `run-20261003-101030-real-window.mov`, on CT's Desktop beside the first video (it is not
in git). Things seen in it that the next round should fix:

- Underground the picture is near black. The window's brightness is now set to "Bright" in
  its options, which takes effect the next time the window is opened new.
- One walk to a log timed out inside `get_wood` and the skill went for another tree.
- After the goal the player stands still and opens its inventory three times: the `rest`
  skill. A run should play on after its goal.
- The first decision took 15.6 s, the rest 5 to 8 s: the model, the game window and the
  recorder share four cores.

## How the real window is played

- `tools/hands/hands.swift` presses keys and mouse buttons in the game's window. It needs
  the Accessibility permission for whatever program starts it; `hands 0 check` says whether
  it has it. Build with `tools/hands/build.sh`.
- The camera is turned by the server (`rotate LocalModel yaw pitch`), in small eased steps.
  A real mouse cannot be told to turn to an exact angle; the server can.
- A second, silent player named Eyes rides along in spectator mode. It never acts. It gives
  the program what a person gets from looking: which blocks are where, and a path.
- The player reads a strip of its own screen to know whether an inventory or crafting table
  is showing. The panel's grey is exactly 198, 198, 198. This needs Screen Recording
  permission; without it the player falls back to counting key presses.
- Between runs the window sits on "Connection Lost". Three presses bring it back: Back to
  Server List, Direct Connection, Enter. If that fails it is closed and opened new.

## What went wrong, in the order it was found

1. **The window was never found.** `pgrep -f "username LocalModel"` returned nothing while
   the window was open: its command line is 9,743 characters and pgrep does not search that
   far. Found because the test tool could not take a picture. The process list is now read
   whole with `ps -axww`.
2. **A table that was placed was reported as not placed.** The check looked for the table in
   the one cell that was aimed at. A leaf in the way took it a block off. Worse, the next
   right click landed on the table and opened its screen, which nothing knew was open. The
   table is now "down" when it is no longer carried, and the screen is read from its pixels.
3. **The nearest log is often a branch.** Going for it walked the player up into the canopy
   (y 77), where paths timed out and no ground could be found for a table. Logs are now taken
   from the foot of a trunk: at most 3 blocks above the ground under them.
4. **A dug stone's cobblestone was left lying.** The walk to a drop stopped one block short
   whenever the drop was in the next cell. The player now walks onto the drop's own block,
   and straight at it when no path is found.
5. **No place for a table in a pit.** After digging down to stone the player stands in a
   hole it dug. The table may now go on any face in reach, walls included.

Each of these was invisible to the 50 offline tests. They test where to click and what to
click; only the game can say whether the click did what was meant.

## For whoever continues

- Start real-window runs from a program that has both permissions. This session's editor
  has them; Terminal may not. `tools/play_window.command` checks and says so.
- While a real-window run plays, the game has the keyboard and the mouse.
- `--body hands` and `--body bot` take the same playbooks. Runs are marked in the database:
  `options_json` is `{"body":"hands"}`.
