#!/usr/bin/env node
// Can the real game be played by pressing keys and clicking from outside it? This starts the
// server and a real game window as the player, then tries the four things everything else
// would be built on, and reports what the server says happened:
//   1. hold W: does the player move?
//   2. the server's rotate command: does the camera turn to an exact direction?
//   3. tap E: does the inventory screen open? (a screenshot before and after)
//   4. hold the left mouse button looking at the ground: does a block break?
// Screenshots go to the folder given as the first argument.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../games/minecraft/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HANDS = join(ROOT, 'runtime', 'bin', 'hands');
const SHOTS = process.argv[2] ?? join(ROOT, 'data', 'probe');
mkdirSync(SHOTS, { recursive: true });
const started = Date.now();
const say = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${text}`);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (file, args) => execFileSync(file, args, { encoding: 'utf8' }).trim();

const lines = [];
let server = null;
let pid = null;
try {
  server = await startServer({ root: ROOT, seed: '7040093665601660210', log: (line) => lines.push(line) });
  say('server ready');

  // Ask the server something and wait for its answer in the log.
  const ask = async (command, pattern, ms = 4000) => {
    const from = lines.length;
    server.command(command);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const hit = lines.slice(from).map((line) => line.match(pattern)).find(Boolean);
      if (hit) return hit;
      await pause(50);
    }
    return null;
  };
  const position = async () => {
    const hit = await ask('data get entity LocalModel Pos', /entity data: \[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/);
    return hit ? hit.slice(1, 4).map(Number) : null;
  };

  const launched = sh(process.execPath, [join(ROOT, 'tools', 'watch_client.mjs'), 'launch', '--player']);
  pid = (launched.match(/process (\d+)/) ?? [])[1] ?? null;
  if (!pid) throw new Error(`the game window did not start: ${launched}`);
  const deadline = Date.now() + 150000;
  while (!lines.some((line) => /LocalModel joined the game/.test(line))) {
    if (Date.now() > deadline) throw new Error('the game window never joined the server');
    await pause(500);
  }
  say('the game window joined as LocalModel');
  await pause(9000);   // let the land around it load and draw
  const rect =sh('osascript', ['-l', 'JavaScript', '-e', `
    ObjC.import("CoreGraphics");
    var all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0)));
    var w = all.filter(function (w) { return w.kCGWindowOwnerPID == ${pid} && w.kCGWindowLayer === 0 && w.kCGWindowBounds.Width >= 600; })[0];
    w ? [w.kCGWindowBounds.X, w.kCGWindowBounds.Y, w.kCGWindowBounds.Width, w.kCGWindowBounds.Height].join(",") : "";`]);
  if (!rect) throw new Error('the game window is not on screen');
  const [wx, wy, ww, wh] = rect.split(',').map(Number);
  const inside = `${wx},${wy + 28},${ww},${wh - 28}`;
  const centre = [wx + ww / 2, wy + 28 + (wh - 28) / 2];
  say(`game process ${pid}, window at ${rect}`);
  const hands = (...args) => sh(HANDS, [pid, ...args.map(String)]);
  const shot = (name) => sh('screencapture', ['-x', '-R', inside, join(SHOTS, `${name}.png`)]);

  hands('front');
  await pause(500);
  hands('click', 'left', ...centre);   // the first click only takes the pointer into the game
  await pause(800);
  shot('1-start');

  // 1. walk
  const before = await position();
  hands('key', 'down', 13);
  await pause(1500);
  hands('key', 'up', 13);
  await pause(400);
  const after = await position();
  const moved = before && after ? Math.hypot(after[0] - before[0], after[2] - before[2]) : NaN;
  say(`1. hold W for 1.5 s: moved ${moved.toFixed(2)} blocks  (${before} -> ${after})`);

  // 2. turn
  server.command('rotate LocalModel 90 20');
  await pause(500);
  const rotation = await ask('data get entity LocalModel Rotation', /entity data: \[(-?[\d.]+)f, (-?[\d.]+)f\]/);
  say(`2. rotate to 90, 20: the server now reports ${rotation ? `${rotation[1]}, ${rotation[2]}` : 'nothing'}`);

  // 3. inventory
  hands('tap', 14);
  await pause(900);
  shot('2-inventory-open');
  hands('tap', 14);
  await pause(700);
  shot('3-inventory-closed');
  say('3. tapped E twice; see 2-inventory-open.png and 3-inventory-closed.png');

  // 4. dig: look down at the ground ahead and hold the left button
  server.command('rotate LocalModel 90 55');
  await pause(600);
  hands('mouse', 'down', 'left', ...centre);
  await pause(1800);
  shot('4-digging');
  await pause(1200);
  hands('mouse', 'up', 'left', ...centre);
  await pause(400);
  hands('key', 'down', 13);
  await pause(900);
  hands('key', 'up', 13);
  await pause(800);
  const inventory = await ask('data get entity LocalModel Inventory', /entity data: (\[.*\])/);
  say(`4. held the left button 3 s, then walked on: carrying ${inventory ? inventory[1].slice(0, 200) : 'unknown'}`);
  shot('5-end');
} catch (error) {
  say(`FAILED: ${error.message}`);
} finally {
  if (pid) { try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ } }
  await pause(1500);
  await server?.stop();
  say('game window closed, server stopped');
}
