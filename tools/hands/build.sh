#!/bin/bash
# Build the keys-and-mouse helper from its source, into runtime/bin/hands.
# Needs the Swift compiler that comes with Apple's command line tools (xcode-select --install).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$ROOT/runtime/bin"
xcrun swiftc -O "$ROOT/tools/hands/hands.swift" -o "$ROOT/runtime/bin/hands.new"
mv "$ROOT/runtime/bin/hands.new" "$ROOT/runtime/bin/hands"
"$ROOT/runtime/bin/hands" 0 check
echo "RESULT: PASS, built runtime/bin/hands"
