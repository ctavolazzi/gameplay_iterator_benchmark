# CLAUDE.md

A harness where a small local model plays a game, one logged run at a time, and the code it
uses is improved between runs. Minecraft is the first game.

Start with [notes/README.md](notes/README.md): the reading order, the standing rules, and
where the data is. Then [notes/roadmap.md](notes/roadmap.md) for what to build next.

The rules that most often matter:

- One run at a time: ports 25565 and 8089. Check they are free. Tell other sessions.
- No paid API calls in the loop. Do not run `./iterate.mjs coach` or `loop` unless CT asks.
- CT is often on a slow phone hotspot. Measure before downloading.
- No em dashes or en dashes in anything you write.
- `npm test` must pass before a commit. Commit and push each finished piece.
- Add what you learn to `notes/`, dated, with what was measured.

## Claude's own player

`claude_player/` is a second thing in this repository: a Minecraft player that plays by
itself in CT's co-op world on port 25566 and is improved by a Claude session reading its
journal. Start at [claude_player/README.md](claude_player/README.md). It may be running
right now in a Terminal window: `node claude_player/player.mjs status` says. Its world is
CT's: never start, stop or restart the server on 25566.

