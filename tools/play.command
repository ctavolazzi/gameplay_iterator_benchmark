#!/bin/bash
# Double-click, or run `open tools/play.command`: the local model plays one run of
# Minecraft, shown live in this Terminal window. If the 26.1 game files are in place, a game
# window opens too, already connected and watching the bot, and the run waits for it.
cd "$(dirname "$0")/.." || exit 1
clear
WINDOW=""
if node tools/watch_client.mjs ready >/dev/null 2>&1; then
  WINDOW="--window"
  echo "A game window will open once the server is up. The run starts when it has joined."
else
  echo "No game window this time: the 26.1 game files are not all here yet."
  echo "(tools/download_game.command fetches them.) The run is shown here in the terminal."
fi
# Pinned to a playbook that has proven itself in the game: v004 reached all 11 milestones
# (stone pickaxe, iron, coal, furnace) in three runs out of three, runs 22, 24 and 25.
./iterate.mjs run --game minecraft --player llama --calls 16 --playbook v004 $WINDOW
echo
echo "The run is over and saved in the database."
