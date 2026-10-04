#!/bin/sh
# Start Claude's player in the local co-op world from a Terminal window, where no chat
# session's time limit can stop it. Double-click, or: open claude_player/play.command
# It joins 127.0.0.1:25566 as "Claude" with the brain on. Ctrl-C leaves the game cleanly.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data/claude_player
exec node claude_player/player.mjs serve --port 25566 2>&1 | tee -a data/claude_player/player.log
