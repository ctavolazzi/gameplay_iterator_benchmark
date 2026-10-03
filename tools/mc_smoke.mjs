#!/usr/bin/env node
// Smoke test for the Minecraft stack, with no model involved: start the server on a fresh
// world, join a bot, look around, walk to a tree, dig a log, pick it up, craft planks.
// Each stage prints what it measured. Ends with RESULT: PASS or RESULT: FAIL.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { MC_VERSION, startServer } from '../games/minecraft/server.mjs';

const { pathfinder, Movements, goals } = pathfinderPackage;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = process.argv[2] ?? '7040093665601660210';
const started = Date.now();
const say = (text) => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s] ${text}`);
const within = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} s`)), ms))]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let bot = null;
let passed = false;
try {
  say(`starting the ${MC_VERSION} server on a fresh world, seed ${SEED}`);
  server = await startServer({ root: ROOT, seed: SEED, log: (line) => { if (/Done \(|Preparing spawn|ERROR|Exception/.test(line)) say(`server: ${line.slice(0, 140)}`); } });
  say('server is ready');

  bot = mineflayer.createBot({ host: '127.0.0.1', port: server.port, username: 'LocalModel', auth: 'offline', version: MC_VERSION });
  bot.on('kicked', (reason) => say(`KICKED: ${JSON.stringify(reason).slice(0, 200)}`));
  bot.on('error', (error) => say(`bot error: ${error.message}`));
  bot.loadPlugin(pathfinder);
  await within(new Promise((resolve) => bot.once('spawn', resolve)), 60000, 'joining');
  await within(bot.waitForChunksToLoad(), 60000, 'loading the land');
  const p = bot.entity.position;
  say(`joined as ${bot.username}: at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}; health ${bot.health}, food ${bot.food}; time of day ${bot.time.timeOfDay}; mode ${bot.game.gameMode}; dimension ${bot.game.dimension}`);

  const interesting = /_log$|^stone$|^sand$|^water$|_ore$|^grass_block$|^dirt$|_leaves$/;
  const counts = {};
  for (const at of bot.findBlocks({ matching: (b) => interesting.test(b.name), maxDistance: 32, count: 4000 })) {
    const name = bot.blockAt(at).name;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  say(`within 32 blocks: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ') || 'nothing of interest'}`);

  const logs = bot.findBlocks({ matching: (b) => /_log$/.test(b.name), maxDistance: 48, count: 200 });
  if (!logs.length) throw new Error('no tree within 48 blocks of spawn');
  logs.sort((a, b) => (a.y - b.y) || (a.distanceTo(p) - b.distanceTo(p)));
  const feet = Math.floor(p.y);
  const target = logs.find((at) => at.y <= feet + 3) ?? logs[0];
  const block = bot.blockAt(target);
  say(`nearest reachable log: ${block.name} at ${target.x}, ${target.y}, ${target.z}, ${target.distanceTo(p).toFixed(1)} blocks away`);

  bot.pathfinder.setMovements(new Movements(bot));
  const walkStart = Date.now();
  await within(bot.pathfinder.goto(new goals.GoalLookAtBlock(target, bot.world)), 90000, 'walking to the tree');
  say(`walked to it in ${((Date.now() - walkStart) / 1000).toFixed(1)} s; now ${bot.entity.position.distanceTo(target).toFixed(1)} blocks from the log`);

  const digStart = Date.now();
  await within(bot.dig(bot.blockAt(target)), 30000, 'digging');
  say(`dug the log in ${((Date.now() - digStart) / 1000).toFixed(1)} s; the block there is now ${bot.blockAt(target).name}`);
  await within(bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 1)), 30000, 'walking to the dropped log').catch((error) => say(`could not step onto the spot: ${error.message}`));
  await pause(1500);
  const carried = () => bot.inventory.items().map((i) => `${i.name} x${i.count}`).join(', ') || 'nothing';
  say(`carrying: ${carried()}`);

  const log = bot.inventory.items().find((i) => /_log$/.test(i.name));
  if (!log) throw new Error('the log was dug but never picked up');
  const planks = bot.registry.itemsByName[log.name.replace(/_log$/, '_planks')];
  const recipe = bot.recipesFor(planks.id, null, 1, null)[0];
  if (!recipe) throw new Error(`no recipe found for ${planks.name}`);
  await within(bot.craft(recipe, 1, null), 15000, 'crafting planks');
  say(`crafted planks; carrying: ${carried()}`);
  passed = bot.inventory.items().some((i) => /_planks$/.test(i.name));
} catch (error) {
  say(`FAILED: ${error.message}`);
} finally {
  try { bot?.quit(); } catch { /* already gone */ }
  await pause(500);
  await server?.stop();
  say('server stopped');
}
console.log(passed ? 'RESULT: PASS (server started, bot joined, walked, dug a log, picked it up, crafted planks)' : 'RESULT: FAIL');
process.exit(passed ? 0 : 1);
