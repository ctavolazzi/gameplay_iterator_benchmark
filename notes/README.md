# Notes

For whoever picks this up next: a later Claude session, or a person. Read in this order.

1. [../README.md](../README.md): what is built, every result, how to run it.
2. [roadmap.md](roadmap.md): the phases ahead and what "done" means for each.
3. The session notes below, newest first: what was tried, what was measured, what went wrong.

| Note | What it covers |
| --- | --- |
| [2026-10-03-real-window.md](2026-10-03-real-window.md) | The real game window learns to play by keys and mouse: what works, how each part was checked, five faults found only by playing |
| [runs/2026-10-03-two-coaches.md](runs/2026-10-03-two-coaches.md) | Two Claude coaches, one brief: v005s against v005o, read from the database |
| [runs/v005s.md](runs/v005s.md), [runs/v005o.md](runs/v005o.md) | Each coach's own notes on its playbook and its three runs |
| [2026-10-03-first-session.md](2026-10-03-first-session.md) | The first night: harness, the loop, Minecraft, the first video, and the mistakes |

## Standing rules

These come from the owner, CT, or from something that went wrong. Each has cost time once.

- **One run at a time.** A run uses port 25565 (the game server) and 8089 (the model
  server). Check both are free before starting. Two sessions sharing this machine must tell
  each other before taking the ports.
- **No paid API calls in the loop.** The model that plays is local. The coach is a Claude
  session in chat reading the database. `./iterate.mjs coach` and `loop` call Claude
  headlessly and are priced per call: do not use them unless CT asks.
- **The network is often a phone hotspot** at about 60 KB a second. Measure before any
  download over about 20 MB, and hold large ones for wifi.
- **Never delete `~/Desktop/run-20261003-080031.mov`**, the first video. Other videos in
  `recordings/` may go when disk is short.
- **Start runs that matter from a Terminal window** (`open tools/play.command`), not from a
  Claude session's own shell, where an interrupt can end them. The exception is a run in the
  real game window (`--body hands`): it must be started by a program that macOS lets press
  keys and see the screen, and Terminal may not be one. `runtime/bin/hands 0 check` says.
- **A real-window run takes the keyboard and the mouse.** Say so before starting one.
- **Commit and push each finished piece.** Notes for a run or a session go in this folder.
- **No em dashes or en dashes** in anything written here.
- **Look at the result, not the exit code.** Read the database row, the log line, a frame
  of the video. Plant a fault and watch a check catch it before trusting it.

## Where the data is

`data/benchmark.sqlite` and `data/runs/*.jsonl` hold every run. They are not in git. Useful
first queries:

```sh
./iterate.mjs runs
sqlite3 data/benchmark.sqlite "SELECT seq, tick, json_extract(action,'$.name'), result FROM steps WHERE run_id = 22"
sqlite3 data/benchmark.sqlite "SELECT seq, tick, kind, detail_json FROM events WHERE run_id = 22"
```
