#!/usr/bin/env node
// A game window to watch a run in. The server is Minecraft 26.1, and a game can only join a
// server of its own version, so this keeps its own 26.1 copy of the game under
// runtime/client-26.1/ and starts it already connected to the local server. The launcher and
// its installations are never written to; files it already has are used where they are.
//
//   tools/watch_client.mjs fetch     download what is missing (resumable, checksum verified)
//   tools/watch_client.mjs launch    open the game window, joined to localhost as a spectator
//   tools/watch_client.mjs ready     exit 0 only if every file the window needs is in place
//
// The game is started in offline mode, which only works with this project's own local
// server. Every file comes from Mojang's servers, listed by Mojang's own 26.1 manifest.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = join(ROOT, 'runtime', 'client-26.1');
const LAUNCHER = join(homedir(), 'Library', 'Application Support', 'minecraft');
const MANIFEST_URL = 'https://piston-meta.mojang.com/v1/packages/84d0ff7bd4428695691af5a178edae22c7c83d89/26.1.json';
const MANIFEST = join(HOME, '26.1.json');
const JAR = join(HOME, 'versions', '26.1', '26.1.jar');
const JAVA = join(ROOT, 'runtime', 'jre-25', 'Contents', 'Home', 'bin', 'java');

const sha1 = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');
const size = (file) => (existsSync(file) ? statSync(file).size : 0);
const good = (file, want) => size(file) === want.size && sha1(file) === want.sha1;
const megabytes = (n) => `${(n / 1e6).toFixed(1)} MB`;

const curl = (url, part) => new Promise((resolve) => {
  spawn('curl', ['-L', '--fail', '--silent', '--connect-timeout', '30', '--speed-limit', '500',
    '--speed-time', '90', '-C', '-', '-o', part, url], { stdio: 'ignore' }).on('exit', resolve);
});

// Download one file, resuming a partial one, and refuse it unless size and sha1 match.
// progress(bytes) is told how much of this file is here, once a second.
async function download(url, file, want, progress = () => {}) {
  if (good(file, want)) return;
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  for (let attempt = 1; size(part) !== want.size; attempt++) {
    if (size(part) > want.size) rmSync(part);
    if (attempt > 40) throw new Error(`gave up on ${url} with ${size(part)} of ${want.size} bytes`);
    const timer = setInterval(() => progress(size(part)), 1000);
    await curl(url, part);          // a dropped connection ends this; the loop resumes it
    clearInterval(timer);
  }
  if (sha1(part) !== want.sha1) { rmSync(part); throw new Error(`${url} arrived with the wrong checksum`); }
  renameSync(part, file);
}

const allowed = (rules) => !rules || rules.some((r) => r.action === 'allow' && (!r.os || r.os.name === 'osx') && !r.features);

// Every library this Mac needs, each resolved to a file: the launcher's copy if it has one.
function libraries(manifest) {
  const out = [];
  for (const lib of manifest.libraries) {
    const artifact = lib.downloads?.artifact;
    if (!artifact || !allowed(lib.rules)) continue;
    if (process.arch === 'x64' && /natives-macos-arm64/.test(lib.name)) continue;
    if (process.arch === 'arm64' && /natives-macos$/.test(lib.name)) continue;
    const shared = join(LAUNCHER, 'libraries', artifact.path);
    const own = join(HOME, 'libraries', artifact.path);
    out.push({ artifact, file: size(shared) === artifact.size ? shared : own, own });
  }
  return out;
}

// Three lines, redrawn in place: what this is, how far along, how long is left.
function display(total) {
  const live = process.stdout.isTTY;
  const samples = [];
  let drawn = false;
  let lastPrinted = 0;
  return (done, finished = false) => {
    const now = Date.now();
    samples.push({ now, done });
    while (samples.length > 2 && now - samples[0].now > 30000) samples.shift();
    const first = samples[0];
    const speed = now > first.now ? ((done - first.done) / (now - first.now)) * 1000 : 0;
    const left = total - done;
    let remaining = 'working out how long is left';
    if (finished || left <= 0) remaining = 'finished';
    else if (speed > 0 && now - first.now > 4000) {
      const seconds = left / speed;
      const time = seconds < 45 ? 'under a minute' : seconds < 5400 ? `about ${Math.max(1, Math.round(seconds / 60))} minutes` : `about ${(seconds / 3600).toFixed(1)} hours`;
      remaining = `${time} left at ${Math.round(speed / 1000)} KB a second`;
    }
    const percent = total ? Math.floor((done / total) * 100) : 100;
    const lines = [`  ${String(percent).padStart(3)}%   ${megabytes(done)} of ${megabytes(total)} downloaded`, `         ${remaining}`];
    if (live) {
      if (drawn) process.stdout.write('\x1b[2A');
      for (const line of lines) process.stdout.write(`\x1b[2K${line}\n`);
      drawn = true;
    } else if (finished || now - lastPrinted > 30000) {
      console.log(lines.map((line) => line.trim()).join(', '));
      lastPrinted = now;
    }
  };
}

async function fetchAll() {
  mkdirSync(HOME, { recursive: true });
  if (!existsSync(MANIFEST)) execFileSync('curl', ['-L', '--fail', '--silent', '-o', MANIFEST, MANIFEST_URL]);
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

  // First work out everything that is missing, so the progress shown is of the whole job.
  const jobs = [];
  const need = (url, file, want) => { if (!good(file, want)) jobs.push({ url, file, want }); };
  need(manifest.downloads.client.url, JAR, manifest.downloads.client);
  const libs = libraries(manifest);
  for (const lib of libs) if (lib.file === lib.own) need(lib.artifact.url, lib.own, lib.artifact);
  // Sounds and textures: link to the launcher's copy of each file, fetch the few it lacks.
  const index = join(HOME, 'assets', 'indexes', `${manifest.assetIndex.id}.json`);
  await download(manifest.assetIndex.url, index, manifest.assetIndex);
  const objects = Object.values(JSON.parse(readFileSync(index, 'utf8')).objects);
  for (const object of objects) {
    const rel = join(object.hash.slice(0, 2), object.hash);
    const mine = join(HOME, 'assets', 'objects', rel);
    if (existsSync(mine)) continue;
    const theirs = join(LAUNCHER, 'assets', 'objects', rel);
    mkdirSync(dirname(mine), { recursive: true });
    if (size(theirs) === object.size) { symlinkSync(theirs, mine); continue; }
    need(`https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, mine, { size: object.size, sha1: object.hash });
  }

  const total = jobs.reduce((sum, job) => sum + job.want.size, 0);
  console.log('Minecraft 26.1 for the watch window');
  if (!jobs.length) {
    console.log('  100%   everything is already here');
  } else {
    const show = display(total);
    let done = 0;
    show(Math.min(size(`${jobs[0].file}.part`), jobs[0].want.size));
    for (const job of jobs) {
      await download(job.url, job.file, job.want, (partial) => show(done + partial));
      done += job.want.size;
      show(done, done === total);
    }
  }

  const missing = libs.filter((lib) => !existsSync(lib.file)).length
    + objects.filter((o) => !existsSync(join(HOME, 'assets', 'objects', o.hash.slice(0, 2), o.hash))).length
    + (good(JAR, manifest.downloads.client) ? 0 : 1);
  console.log(missing === 0 ? 'RESULT: PASS, every file is in place and checked' : `RESULT: FAIL, ${missing} files still missing`);
  return missing === 0;
}

function launch() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const libs = libraries(manifest);
  const absent = [JAVA, JAR, ...libs.map((lib) => lib.file)].filter((file) => !existsSync(file));
  if (absent.length) throw new Error(`not ready, ${absent.length} files missing (first: ${absent[0]}); run: tools/watch_client.mjs fetch`);
  // --player: this window IS the player, driven by tools/hands. Otherwise it only watches.
  const asPlayer = process.argv.includes('--player');
  const gameDir = join(HOME, asPlayer ? 'game-player' : 'game');
  const natives = join(HOME, 'natives');
  mkdirSync(gameDir, { recursive: true });
  mkdirSync(natives, { recursive: true });
  // Skip the first-run screens, so the window goes straight to the server.
  if (!existsSync(join(gameDir, 'options.txt'))) {
    const options = ['onboardAccessibility:false', 'tutorialStep:none', 'skipMultiplayerWarning:true', 'joinedFirstServer:true', 'pauseOnLostFocus:false'];
    // The player's window: a fixed interface size so screen positions can be worked out,
    // stepping up blocks by itself as most people play, and a short view to spare the Mac.
    if (asPlayer) options.push('guiScale:4', 'autoJump:true', 'renderDistance:6', 'fullscreen:false', 'narrator:0');
    writeFileSync(join(gameDir, 'options.txt'), `${options.join('\n')}\n`);
  }
  const fill = {
    natives_directory: natives, launcher_name: 'gameplay_iterator_benchmark', launcher_version: '1',
    classpath: [...libs.map((lib) => lib.file), JAR].join(':'), classpath_separator: ':',
    library_directory: join(HOME, 'libraries'), version_name: '26.1', game_directory: gameDir,
    assets_root: join(HOME, 'assets'), assets_index_name: manifest.assetIndex.id,
    auth_player_name: asPlayer ? 'LocalModel' : 'Watcher',
    auth_uuid: asPlayer ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', auth_access_token: '0',
    clientid: '0', auth_xuid: '0', user_type: 'legacy', version_type: manifest.type,
  };
  const substitute = (text) => text.replace(/\$\{(\w+)\}/g, (whole, key) => fill[key] ?? whole);
  const plain = (list) => list.flatMap((entry) => {
    if (typeof entry === 'string') return [substitute(entry)];
    return allowed(entry.rules) ? [].concat(entry.value).map(substitute) : [];
  });
  const args = [
    ...plain(manifest.arguments.jvm), '-Xmx2G', manifest.mainClass, ...plain(manifest.arguments.game),
    // 960 by 540 points is 1920 by 1080 pixels on this display: a standard video size.
    '--quickPlayMultiplayer', 'localhost:25565', '--width', '960', '--height', '540',
  ];
  mkdirSync(join(HOME, 'logs'), { recursive: true });
  const log = join(HOME, 'logs', 'client.log');
  const out = openSync(log, 'w');
  const child = spawn(JAVA, args, { cwd: gameDir, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  console.log(`game window starting (process ${child.pid}); its log is ${log}`);
}

function ready() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  const absent = manifest
    ? [JAVA, JAR, ...libraries(manifest).map((lib) => lib.file), join(HOME, 'assets', 'indexes', `${manifest.assetIndex.id}.json`)].filter((file) => !existsSync(file))
    : [MANIFEST];
  console.log(absent.length ? `not ready: ${absent.length} files missing` : 'ready');
  return absent.length === 0;
}

const command = process.argv[2];
try {
  if (command === 'fetch') process.exitCode = (await fetchAll()) ? 0 : 1;
  else if (command === 'launch') launch();
  else if (command === 'ready') process.exitCode = ready() ? 0 : 1;
  else { console.log('usage: tools/watch_client.mjs fetch | launch | ready'); process.exitCode = 2; }
} catch (error) {
  console.log(`error: ${error.message}`);
  console.log('RESULT: FAIL');
  process.exitCode = 1;
}
