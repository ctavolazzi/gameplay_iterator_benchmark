#!/bin/bash
# Record the game window for one run, with the Mac's own screen recorder.
#
#   tools/record_window.sh              waits for a run started with --window, records it
#   tools/record_window.sh LocalModel   the same for a run played in the real window (--body hands)
#
# Start a run with a game window (tools/play.command) and run this beside it. It waits until
# the named player (Watcher unless told otherwise) has joined the server, records the inside
# of the game window, and stops when the run's server shuts down. The video lands in
# recordings/, which git ignores.
#
# The program that runs this needs Screen Recording permission (System Settings, Privacy).
# The window must stay where it is and uncovered: the recorder films a rectangle of screen.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/runtime/minecraft-server-26.1/logs/latest.log"
OUT_DIR="$ROOT/recordings"
OUT="$OUT_DIR/run-$(date +%Y%m%d-%H%M%S).mov"
TITLE_BAR=28
WHO="${1:-Watcher}"
mkdir -p "$OUT_DIR"

listening() { lsof -nP -iTCP:25565 -sTCP:LISTEN > /dev/null 2>&1; }

# The game window's rectangle in screen points: x,y,width,height. The game runs as "java".
window_rect() {
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
    var game = all.filter(function (w) { return w.kCGWindowOwnerName === "java" && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 600; })[0];
    game ? [game.kCGWindowBounds.X, game.kCGWindowBounds.Y, game.kCGWindowBounds.Width, game.kCGWindowBounds.Height].join(",") : "";
  ' 2>/dev/null
}

echo "waiting for a run with a game window (up to 6 minutes)"
waited=0
until listening && grep -q "$WHO joined the game" "$LOG" 2>/dev/null; do
  sleep 2
  waited=$((waited + 2))
  if [ "$waited" -ge 360 ]; then echo "RESULT: FAIL, $WHO did not join a server within 6 minutes"; exit 1; fi
done

RECT="$(window_rect)"
if [ -z "$RECT" ]; then echo "RESULT: FAIL, $WHO joined but no game window is on screen"; exit 1; fi
IFS=, read -r X Y W H <<< "$RECT"
Y=$((Y + TITLE_BAR))
H=$((H - TITLE_BAR))
echo "game window found; recording ${W}x${H} points at ${X},${Y} to $OUT"

# The recorder stops at the first character it reads. Run with no keyboard attached it reads
# "end of input" at once and records nothing (measured: 5 frames). So it reads from a pipe
# this script holds open, and is stopped by sending one character down it.
STOP="$OUT_DIR/.stop-$$"
rm -f "$STOP"
mkfifo "$STOP"
screencapture -v -R "${X},${Y},${W},${H}" "$OUT" < "$STOP" > /dev/null 2>&1 &
RECORDER=$!
exec 3> "$STOP"
STARTED=$(date +%s)

# Stop when the run's server shuts down, or as soon as the watcher leaves: once the game
# window has left the world there is nothing to film but its menu (the first recording ran
# on for 77 seconds after the watcher left).
while listening && ! grep -q "$WHO left the game" "$LOG" 2>/dev/null; do sleep 2; done
sleep 2
printf 'q' >&3
exec 3>&-
wait "$RECORDER" 2>/dev/null
rm -f "$STOP"
SECONDS_RECORDED=$(( $(date +%s) - STARTED ))

if [ ! -s "$OUT" ]; then echo "RESULT: FAIL, the recorder left no file"; exit 1; fi
echo "recorded for about ${SECONDS_RECORDED} seconds"
echo "RESULT: PASS $OUT"
