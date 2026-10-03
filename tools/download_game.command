#!/bin/bash
# Double-click, or run `open tools/download_game.command`: fetches the 26.1 game files for
# the watch window, showing how far along it is and how long is left. Safe to stop and run
# again; it resumes where it stopped.
cd "$(dirname "$0")/.." || exit 1
clear
if node tools/watch_client.mjs fetch; then
  echo
  echo "Done. The game window is ready to use. This window can be closed."
else
  echo
  echo "Stopped before it finished. Run it again and it carries on from here."
fi
