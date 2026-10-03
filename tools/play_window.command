#!/bin/bash
# Double-click, or run `open tools/play_window.command`: the local model plays one run of
# Minecraft in the real game window, by keys and mouse. You see a player walking, swinging,
# and opening its inventory, and the choices are listed here in the Terminal as they are made.
#
# While it plays, the game window has the keyboard and the mouse. Leave them alone until
# "The run is over" appears here; then the window stays open, ready for the next run.
#
# The program that starts this (Terminal, if you double-clicked) needs two permissions in
# System Settings, Privacy and Security: Accessibility, to press keys, and Screen Recording,
# to see whether a screen is open in the game.
cd "$(dirname "$0")/.." || exit 1
clear
if [ ! -x runtime/bin/hands ]; then
  echo "The keys-and-mouse helper is not built yet. Run: tools/hands/build.sh"
  exit 1
fi
CHECK="$(runtime/bin/hands 0 check 2>&1)"
if ! echo "$CHECK" | grep -q "keys yes"; then
  echo "This program may not press keys yet."
  echo "Open System Settings, Privacy and Security, Accessibility, and switch on the program"
  echo "you started this from (Terminal, if you double-clicked). Then start this again."
  exit 1
fi
if ! echo "$CHECK" | grep -q "screen yes"; then
  echo "Note: this program may not read the screen (Screen Recording is off for it), so it"
  echo "cannot check that the inventory really opened. It will play by counting key presses."
  echo
fi
if ! node tools/watch_client.mjs ready >/dev/null 2>&1; then
  echo "The 26.1 game files are not all here yet. tools/download_game.command fetches them."
  exit 1
fi
echo "The game window will open, or come back from its last run, once the server is up."
# v005s reached all 11 milestones in 6 decisions in runs 29 and 30 with the hidden player.
./iterate.mjs run --game minecraft --player llama --calls "${CALLS:-16}" --playbook "${PLAYBOOK:-v005s}" --body hands
echo
echo "The run is over and saved in the database."
