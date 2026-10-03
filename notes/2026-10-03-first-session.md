# The first session: 2026-10-02 evening to 2026-10-03 morning

One long Claude session with CT, with a second and third session joining for the Minecraft
runs. Everything here was measured on CT's 2015 Intel MacBook Pro (16 GB, macOS 12).

## What was built, in order

1. The harness: runner, SQLite and JSONL store, replay, a testbed grid game, tests with
   planted faults.
2. The loop: a local model as the player through llama.cpp, skills in versioned playbooks,
   a coach step.
3. The Minecraft adapter: a 26.1 server made from one seed each run, a Mineflayer bot.
4. A game window that watches a run, and a recorder for it.
5. The start of the keys-and-mouse body.

## What was measured

- Model speed, Qwen3.5-0.8B 4-bit on CPU: about 97 tokens a second reading, 16 writing.
  A Minecraft decision takes about 3.3 seconds; 4.5 with a game window open; 4.9 with the
  window and the recorder.
- This model family cannot reuse the unchanged start of a prompt on the llama.cpp build of
  2026-04-04. The server log says so: "forcing full prompt re-processing".
- Server start on a fresh world: about 18 seconds. Bot join: about 6.
- A headless Claude call with CT's full setup loaded carried 245,454 tokens. With MCP
  servers, settings and skills switched off: 668.
- The 26.1 game needed 82 MB beyond what the launcher's 26.3 install already had.

## Results

See the tables in the README. In short: raw actions gave 1 milestone, the automatic rewrite
gave 0, the hand-written v003 gave 8 three times, and v004 gave 11, 11, 11 and 10.

## What went wrong, and what it taught

- **A server version nobody could join.** A 1.21.4 server was fetched from a pin in the
  plan page, while the game CT had working was 26.3 and the newest bot library reached
  26.1. Read every consumer's real version before fetching anything pinned.
- **"Something stopped the model server."** Two runs died with `fetch failed`. The cause was
  a kept-alive connection reused after the process had been busy; the server was up. The
  log line taken as proof of a shutdown is written by our own cleanup after any failure.
  Another session found it with a probe in minutes. Reproduce the failing call alone before
  looking for an outside cause.
- **The automatic coach made things worse.** Its briefing mentioned walking away from
  monsters; a zombie was 21 blocks off; the model explored north 25 times.
- **A one-option menu.** The first coached testbed playbook offered one option at a time,
  so the model chose nothing. Found by counting options per decision, which is now stored.
- **The table would not go down.** The placement code accepted only bare ground, and the
  forest floor is grass. Crafts sent back to back also lost track of items.
- **Two sessions, one port.** A queued check started in the gap between another session's
  runs. A run could have been played by the other run's model while recording its own
  name. The model server now refuses to start on a port that already answers.
- **A recorder with no keyboard stops at once.** `screencapture -v` stops at the first
  character it reads; with no terminal it reads end of input and records 5 frames. It now
  reads from a pipe held open.
- **The first video ran on after the viewer left**, and one wrong key dropped the viewer
  out of the bot's view. The camera now returns to the bot at every decision, the viewer
  has night vision, and the recorder stops when the viewer leaves.

## Decisions CT made

- The player that improves is the local model, through code. Claude builds and coaches.
- Game-agnostic harness; Minecraft first.
- Free is king: no paid API calls in the loop. Coaching happens in chat.
- The real game window should show the play: menus opening, tools swinging.
- Keys and mouse for the real window; two bodies, one brain; push each finished piece.
- Each run should aim at a different achievement, then explore.

## Open at the end of the session

- The keys-and-mouse body is proven in parts and not yet built. See the roadmap, phase 1.
- Walking by key press is untested on open ground.
- The changes of commit b111667 (camera returns to the bot, night vision, recorder stop)
  have not been played in the game.
