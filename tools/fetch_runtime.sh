#!/bin/bash
# Fetch what a fresh clone needs and npm cannot supply: a Java runtime, the Minecraft server
# jar, and the local model. All of it lands in runtime/, which git ignores. Nothing is
# installed system-wide; deleting runtime/ undoes all of it.
#
#   tools/fetch_runtime.sh              fetch what is missing, then verify everything
#   tools/fetch_runtime.sh --verify     verify only, download nothing
#   tools/fetch_runtime.sh --self-test  prove the verifier rejects a damaged file
#
# Downloads resume where they stopped, so a slow or dropped connection only costs a rerun.
# A file is used only after its size and checksum match what its publisher lists. The last
# line is RESULT: PASS or RESULT: FAIL; read it, and never judge this script through a pipe.
#
# Versions, all read from their publishers on 2026-10-02:
#   Minecraft 26.1 is the newest version Mineflayer 4.39.0 lists as tested. It needs Java 25.
#   A game can only join a server of its own version, so watching needs a 26.1 installation.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$ROOT/runtime"

# Eclipse Temurin JRE 25 for Intel macOS (api.adoptium.net).
JRE_URL="https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_mac_hotspot_25.0.4.1_1.tar.gz"
JRE_SIZE=42138276
JRE_SHA256="099cbc182af99ab454991a4230f0bdbf2b2ee3f61ce462d637aceaa12709380d"
JRE_VERSION="25.0.4"
JRE_TGZ="$RT/downloads/temurin-jre-25.0.4.1_1-mac-x64.tar.gz"
JRE_HOME="$RT/jre-25/Contents/Home"

# Minecraft Java Edition server 26.1 (Mojang's version manifest).
MC_VERSION="26.1"
SERVER_URL="https://piston-data.mojang.com/v1/objects/3872a7f07a1a595e651aef8b058dfc2bb3772f46/server.jar"
SERVER_SIZE=60417588
SERVER_SHA1="3872a7f07a1a595e651aef8b058dfc2bb3772f46"
SERVER_JAR="$RT/minecraft-server-$MC_VERSION/server.jar"

# The local model: Qwen3.5-0.8B, 4-bit, Apache-2.0 (huggingface.co/unsloth/Qwen3.5-0.8B-GGUF).
MODEL_URL="https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf"
MODEL_SIZE=532517120
MODEL_SHA256="bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517"
MODEL_FILE="$RT/models/Qwen3.5-0.8B-Q4_K_M.gguf"

# The Minecraft-trained candidate: Andy-4.2-Micro, the same base model fine-tuned on
# Minecraft play by the Mindcraft CE team (huggingface.co/Mindcraft-CE/Andy-4.2-Micro;
# this 4-bit file is from huggingface.co/mradermacher/Andy-4.2-Micro-i1-GGUF). Andy 2.0
# License. This work uses data and models created by @Sweaterdog, and the Mindcraft Project.
ANDY_URL="https://huggingface.co/mradermacher/Andy-4.2-Micro-i1-GGUF/resolve/main/Andy-4.2-Micro.i1-Q4_K_M.gguf"
ANDY_SIZE=529297888
ANDY_SHA256="f39d11a3ef05b4fc6388a708b2ae33fe5e28b87916b366dabaeb765f10317ee6"
ANDY_FILE="$RT/models/Andy-4.2-Micro.i1-Q4_K_M.gguf"

size_of() { stat -f %z "$1" 2>/dev/null || echo 0; }
digest() { shasum -a "$1" "$2" 2>/dev/null | cut -d ' ' -f 1; }

# verify <path> <bytes> <sha algorithm: 1 or 256> <expected digest>
verify() {
  local path="$1" size="$2" algo="$3" want="$4" got_size got
  [ -f "$path" ] || { echo "MISSING  $path"; return 1; }
  got_size=$(size_of "$path")
  [ "$got_size" = "$size" ] || { echo "SIZE     $path: $got_size of $size bytes"; return 1; }
  got=$(digest "$algo" "$path")
  [ "$got" = "$want" ] || { echo "CHECKSUM $path: sha$algo is $got, publisher lists $want"; return 1; }
  echo "OK       $path ($size bytes, sha$algo matches)"
}

# fetch <url> <path> <bytes> <sha algorithm> <expected digest>
fetch() {
  local url="$1" path="$2" size="$3" algo="$4" want="$5" part="$2.part" n=0 have
  if verify "$path" "$size" "$algo" "$want" >/dev/null; then return 0; fi
  mkdir -p "$(dirname "$path")"
  while :; do
    have=$(size_of "$part")
    [ "$have" = "$size" ] && break
    if [ "$have" -gt "$size" ]; then rm -f "$part"; have=0; fi
    n=$((n + 1))
    if [ "$n" -gt 40 ]; then
      echo "GAVE UP  $url after 40 attempts with $have of $size bytes"
      return 1
    fi
    echo "attempt $n: have $have of $size bytes of $(basename "$path")"
    curl -L --fail --silent --show-error --connect-timeout 30 \
      --speed-limit 500 --speed-time 90 -C - -o "$part" "$url" || sleep 5
  done
  mv "$part" "$path"
}

unpack_jre() {
  [ -x "$JRE_HOME/bin/java" ] && return 0
  verify "$JRE_TGZ" "$JRE_SIZE" 256 "$JRE_SHA256" >/dev/null || return 1
  mkdir -p "$RT/jre-25"
  tar -xzf "$JRE_TGZ" -C "$RT/jre-25" --strip-components 1
}

# The runtime counts only if it starts and reports the version that was asked for.
check_java() {
  local out
  [ -x "$JRE_HOME/bin/java" ] || { echo "MISSING  $JRE_HOME/bin/java"; return 1; }
  out=$("$JRE_HOME/bin/java" -version 2>&1) || { echo "BROKEN   java did not run: $out"; return 1; }
  case "$out" in
    *"\"$JRE_VERSION"*) echo "OK       java runs: $(echo "$out" | head -n 1)" ;;
    *) echo "VERSION  wanted $JRE_VERSION, java reports: $out"; return 1 ;;
  esac
}

# A verifier that has never rejected anything proves nothing, so this runs every time.
self_test() {
  local dir size sha ok=1
  dir=$(mktemp -d) || return 1
  printf 'gameplay iterator benchmark\n' > "$dir/intact"
  printf 'gameplay iterator benchmarK\n' > "$dir/changed"
  printf 'gameplay iterator bench' > "$dir/truncated"
  size=$(size_of "$dir/intact")
  sha=$(digest 256 "$dir/intact")
  verify "$dir/intact" "$size" 256 "$sha" >/dev/null || { echo "self-test: an intact file was rejected"; ok=0; }
  verify "$dir/changed" "$size" 256 "$sha" >/dev/null && { echo "self-test: a changed byte was accepted"; ok=0; }
  verify "$dir/truncated" "$size" 256 "$sha" >/dev/null && { echo "self-test: a truncated file was accepted"; ok=0; }
  verify "$dir/absent" "$size" 256 "$sha" >/dev/null && { echo "self-test: a missing file was accepted"; ok=0; }
  rm -rf "$dir"
  if [ "$ok" = 1 ]; then
    echo "SELF-TEST: PASS (intact accepted; changed byte, truncation and missing file rejected)"
  else
    echo "SELF-TEST: FAIL"
    return 1
  fi
}

mode="${1:-fetch}"
case "$mode" in
  fetch | --verify | --self-test) ;;
  *) echo "usage: tools/fetch_runtime.sh [--verify | --self-test]"; exit 2 ;;
esac

self_test || { echo "RESULT: FAIL (the verifier itself is broken)"; exit 1; }
[ "$mode" = "--self-test" ] && exit 0

if [ "$mode" = "fetch" ]; then
  fetch "$JRE_URL" "$JRE_TGZ" "$JRE_SIZE" 256 "$JRE_SHA256"
  fetch "$SERVER_URL" "$SERVER_JAR" "$SERVER_SIZE" 1 "$SERVER_SHA1"
  fetch "$MODEL_URL" "$MODEL_FILE" "$MODEL_SIZE" 256 "$MODEL_SHA256"
  fetch "$ANDY_URL" "$ANDY_FILE" "$ANDY_SIZE" 256 "$ANDY_SHA256"
  unpack_jre
fi

passed=0
verify "$JRE_TGZ" "$JRE_SIZE" 256 "$JRE_SHA256" && passed=$((passed + 1))
verify "$SERVER_JAR" "$SERVER_SIZE" 1 "$SERVER_SHA1" && passed=$((passed + 1))
verify "$MODEL_FILE" "$MODEL_SIZE" 256 "$MODEL_SHA256" && passed=$((passed + 1))
verify "$ANDY_FILE" "$ANDY_SIZE" 256 "$ANDY_SHA256" && passed=$((passed + 1))
check_java && passed=$((passed + 1))

if [ "$passed" = 5 ]; then
  echo "RESULT: PASS (5 of 5: Java $JRE_VERSION archive, Minecraft $MC_VERSION server jar, two model files, java runs)"
  exit 0
fi
echo "RESULT: FAIL ($passed of 5)"
exit 1
