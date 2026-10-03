// Minecraft, through a Mineflayer bot on a local server. The bot is a second player in the
// world: it never touches a game window. The game's own actions here are whole jobs
// (walk to a block and dig it, craft an item, place the table, walk a way off), because a
// model cannot steer a character twenty times a second. Skills in the playbook combine them.
//
// A run is played in real time. The world keeps moving while the model thinks, and the
// server rolls its own dice for mobs, so two runs from the same seed start on the same land
// and then differ. Everything that happens is recorded; nothing here claims to repeat.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import vec3Package from 'vec3';
import {
  BOT_NAME, COLLECTIBLE, CRAFTABLE, DIRECTIONS, NEEDS_PICKAXE, NEEDS_STONE_PICKAXE, NOTICED_SINGLY, TOOL_TIERS,
  TRUNK_REACH, carriedDiffers, describeText, dropOf, gainEvents, heightAboveGround, runMetrics, vocabularyList,
} from './common.mjs';
import { createHandsAdapter } from './hands_adapter.mjs';
import { counts, parseInventory } from './hands_plan.mjs';
import { MC_VERSION, startServer } from './server.mjs';

const { pathfinder, Movements, goals } = pathfinderPackage;
const { Vec3 } = vec3Package;

export const defaults = { seed: '7040093665601660210', budget: { ticks: 12000, calls: 40 } };
// A new playbook is tried on one short live run before it is adopted.
export const validation = { seeds: [defaults.seed], budget: { ticks: 3000, calls: 5 } };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} seconds`)), ms))]);

// Two bodies take the same actions, so one playbook serves both. 'bot' is the hidden
// player below. 'hands' is the real game window, played by keys and mouse (hands_adapter.mjs).
export const BODIES = ['bot', 'hands'];

export function createAdapter({ root, body = 'bot' } = {}) {
  if (!BODIES.includes(body)) throw new Error(`no body '${body}'; there are: ${BODIES.join(', ')}`);
  if (body === 'hands') return createHandsAdapter({ root });
  let server = null;
  let bot = null;
  let startAge = 0;
  let startedAt = 0;
  let dead = false;
  let gone = null;
  let lastHealth = 20;
  let pending = [];      // damage and death, noticed between actions
  let reached = new Set();
  let walked = 0;
  let lastSpot = null;
  const viewers = new Set();   // people watching in a game window, by player name
  let lines = [];        // what the server has printed, for ask() to read answers from

  // Send the server a command and wait for the log line that answers it.
  async function ask(command, pattern, ms = 2000) {
    const from = lines.length;
    server.command(command);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (let i = from; i < lines.length; i++) {
        const hit = lines[i].match(pattern);
        if (hit) return hit;
      }
      await pause(40);
    }
    return null;
  }

  // What the server says is carried, which is the truth. null when it did not answer.
  async function serverCarried() {
    const hit = await ask(`data get entity ${BOT_NAME} Inventory`, /entity data: (\[.*\])\s*$/);
    return hit ? counts(parseInventory(hit[1])) : null;
  }

  // Where the bot's own list of what it carries differs from the server's: { item: [bot, server] }.
  // Skills plan from the bot's list, and it has gone stale before (run 24 sticks, run 28 logs).
  // One difference is given a moment to pass, since a pickup may be on its way.
  async function staleCarried() {
    let differs = {};
    for (let tries = 0; tries < 2; tries++) {
      const truth = await serverCarried();
      if (!truth) return null;
      differs = carriedDiffers(carried(), truth);
      if (!Object.keys(differs).length) return null;
      await pause(500);
    }
    return differs;
  }

  const say =(text) => server?.command(`say ${text}`);
  const carried = () => {
    const out = {};
    for (const item of bot.inventory.items()) out[item.name] = (out[item.name] ?? 0) + item.count;
    return out;
  };
  const has = (pattern) => bot.inventory.items().find((item) => pattern.test(item.name));
  // The best tool of a kind that is carried: a stone pickaxe before a wooden one. Iron ore
  // dug with a wooden pickaxe drops nothing, so "the first pickaxe found" is not good enough.
  const bestTool = (ending) => bot.inventory.items()
    .filter((item) => item.name.endsWith(ending))
    .sort((a, b) => TOOL_TIERS.findIndex((t) => a.name.startsWith(t)) - TOOL_TIERS.findIndex((t) => b.name.startsWith(t)))[0] ?? null;
  const nearest = (name, distance = 32) =>
    bot.findBlock({ matching: (block) => block.name === name, maxDistance: distance });

  // Nearest block of each kind worth knowing about: name -> how many blocks away. Trees are
  // found in one sweep; the rest are looked for one kind at a time, because stone is so
  // common underground that in one shared sweep it crowded out the crafting table (run 20
  // lost sight of its table 23 blocks away and crafted a second one).
  function around() {
    const from = bot.entity.position;
    const best = {};
    const note = (at) => {
      const name = bot.blockAt(at).name;
      const distance = Math.round(at.distanceTo(from));
      if (best[name] === undefined || distance < best[name]) best[name] = distance;
    };
    for (const at of bot.findBlocks({ matching: (block) => block.name.endsWith('_log'), maxDistance: 32, count: 300 })) note(at);
    for (const name of NOTICED_SINGLY) {
      const block = nearest(name, 32);
      if (block) note(block.position);
    }
    return Object.fromEntries(Object.entries(best).sort((a, b) => a[1] - b[1]).slice(0, 8));
  }

  function recipeFor(want) {
    const names = want === 'planks'
      ? Object.keys(bot.registry.itemsByName).filter((name) => name.endsWith('_planks'))
      : [want];
    const table = nearest('crafting_table', 32);
    for (const name of names) {
      const item = bot.registry.itemsByName[name];
      if (!item) continue;
      const recipe = bot.recipesFor(item.id, null, 1, table)[0];
      if (recipe) return { recipe, table: recipe.requiresTable ? table : null };
    }
    return null;
  }

  async function settle() {
    for (let i = 0; i < 20 && !bot.entity.onGround; i++) await pause(100);
  }

  async function walkTo(goal, ms, what) {
    try {
      await within(bot.pathfinder.goto(goal), ms, what);
    } catch (error) {
      bot.pathfinder.setGoal(null);
      throw error;
    }
  }

  // The nearest block of a kind that someone standing on the ground can reach. Never one up
  // a tree: run 12 took fall damage three times going after logs in the treetops.
  const nameAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;

  function reachable(name) {
    const from = bot.entity.position;
    const feet = Math.floor(from.y);
    const found = bot.findBlocks({ matching: (block) => block.name === name, maxDistance: 48, count: 128 });
    const nearestOf = (list) => list.sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0] ?? null;
    if (name.endsWith('_log')) {
      // The foot of a trunk, as a person would take it, and not a branch up in the leaves:
      // the real window learned this first, and both bodies should fell a tree the same way.
      const trunk = nearestOf(found.filter((at) => heightAboveGround(nameAt, at) <= TRUNK_REACH));
      if (trunk) return trunk;
    }
    // Stone and ore can be dug down to with the pickaxe. Run 20 spawned on a hill at y 83
    // with all the stone more than 6 blocks below, and had nothing to do but explore.
    const lowest = NEEDS_PICKAXE.test(name) ? feet - 20 : feet - 6;
    return nearestOf(found.filter((at) => at.y <= feet + 2 && at.y >= lowest));
  }

  async function collect(name) {
    const target = reachable(name);
    if (!target) return { ok: false, error: `no ${name} within reach of the ground nearby` };
    const before = carried();
    await walkTo(new goals.GoalLookAtBlock(target, bot.world), 45000, `walking to the ${name}`);
    await settle();
    // The tool goes in hand after the walk, not before it. The pathfinder digs its own way
    // through and puts what suits that digging in hand, so a tool chosen before the walk may
    // not be the one held at the end of it. Run 36 dug its first iron ore with the wooden
    // pickaxe, which drops nothing: the stone pickaxe showed 1 use after the second dig.
    const tool = bestTool(NEEDS_PICKAXE.test(name) ? '_pickaxe' : '_axe');
    if (tool) await bot.equip(tool, 'hand');
    try {
      await within(bot.dig(bot.blockAt(target)), 40000, `digging the ${name}`);
    } catch (error) {
      bot.stopDigging();
      throw error;
    }
    // Pick up what dropped. Walk to where the block was, and if it has not arrived, to the
    // nearest dropped item: ore dug from a wall can fall out of reach of that spot (run 22
    // dug iron ore and picked nothing up). The dig is done when what the block leaves behind
    // is carried, not when anything at all was gained: dirt and cobblestone dug on the way
    // used to end the pickup and leave the ore's own drop lying there (run 28, iron and coal).
    const wanted = dropOf(name);
    const gained = () => (carried()[wanted] ?? 0) > (before[wanted] ?? 0);
    await walkTo(new goals.GoalNear(target.x, target.y, target.z, 1), 10000, 'picking it up').catch(() => {});
    for (let waited = 0; waited < 6 && !gained(); waited++) {
      await pause(600);
      if (gained()) break;
      const drop = bot.nearestEntity((entity) => entity.name === 'item' && entity.position.distanceTo(bot.entity.position) < 8);
      if (drop) await walkTo(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0), 6000, 'reaching the dropped item').catch(() => {});
    }
    await pause(400);
    const after = carried();
    const got = Object.fromEntries(Object.keys(after).filter((k) => after[k] > (before[k] ?? 0)).map((k) => [k, after[k] - (before[k] ?? 0)]));
    if (got[wanted]) return { ok: true, got };
    const also = Object.keys(got).length ? ` (picked up on the way: ${Object.keys(got).join(', ')})` : '';
    return { ok: false, error: `dug the ${name} but did not pick up its ${wanted}${also}` };
  }

  async function craft(want) {
    const found = recipeFor(want);
    if (!found) return { ok: false, error: `cannot craft ${want} with what you carry` };
    if (found.table && found.table.position.distanceTo(bot.entity.position) > 3.5) {
      // Up to 32 blocks, possibly uphill: run 20 timed out three times at 30 seconds.
      await walkTo(new goals.GoalNear(found.table.position.x, found.table.position.y, found.table.position.z, 2), 75000, 'walking to the crafting table');
    }
    const before = carried();
    await within(bot.craft(found.recipe, 1, found.table), 15000, `crafting ${want}`);
    // Let the server confirm before anything else touches what is carried. Crafts sent
    // back to back (run 15, a scripted player with no thinking time) lost track of items.
    await pause(700);
    const after = carried();
    const made = Object.fromEntries(Object.keys(after).filter((k) => after[k] > (before[k] ?? 0)).map((k) => [k, after[k] - (before[k] ?? 0)]));
    return { ok: true, made };
  }

  async function placeTable() {
    const table = has(/^crafting_table$/);
    if (!table) return { ok: false, error: 'you carry no crafting table' };
    await settle();
    const base = bot.entity.position.floored();
    let tried = 0;
    let lastError = 'no solid ground with open space above it within 2 blocks';
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      for (const dy of [-1, 0, -2]) {
        const ground = bot.blockAt(base.offset(dx, dy, dz));
        const above = bot.blockAt(base.offset(dx, dy + 1, dz));
        // Open space is air or something a block replaces, such as grass. Not water.
        const open = above && above.boundingBox === 'empty' && !/water|lava/.test(above.name);
        if (ground?.boundingBox !== 'block' || !open || tried >= 4) continue;
        tried += 1;
        try {
          await bot.equip(table, 'hand');
          await within(bot.placeBlock(ground, new Vec3(0, 1, 0)), 8000, 'placing the table');
          return { ok: true, placed: 'crafting_table' };
        } catch (error) {
          lastError = String(error?.message ?? error).slice(0, 120);
          // The server may have placed it even though the confirmation never came.
          if (nearest('crafting_table', 4)) return { ok: true, placed: 'crafting_table' };
        }
      }
    }
    return { ok: false, error: `could not put the table down (${tried} spots tried): ${lastError}` };
  }

  async function explore(direction) {
    const [dx, dz] = DIRECTIONS[direction];
    const from = bot.entity.position.clone();
    await walkTo(new goals.GoalNearXZ(from.x + dx * 24, from.z + dz * 24, 3), 30000, `walking ${direction}`).catch(() => {});
    const moved = Math.round(bot.entity.position.distanceTo(from));
    return moved >= 3 ? { ok: true, moved } : { ok: false, error: `could not get far going ${direction}` };
  }

  function actions() {
    if (!bot || dead || gone) return [];
    const list = [];
    const seen = around();
    const inventory = carried();
    for (const name of Object.keys(seen)) {
      if (!COLLECTIBLE.test(name)) continue;
      if (NEEDS_PICKAXE.test(name) && !has(/_pickaxe$/)) continue;
      if (NEEDS_STONE_PICKAXE.test(name) && !has(/^(stone|iron|diamond|netherite)_pickaxe$/)) continue;
      const target = reachable(name);
      if (!target) continue;
      const distance = Math.round(target.distanceTo(bot.entity.position));
      list.push({ name: `collect:${name}`, about: `walk ${distance} blocks to the nearest ${name} and dig one` });
    }
    for (const want of CRAFTABLE) {
      const found = recipeFor(want);
      if (found) list.push({ name: `craft:${want}`, about: `make ${want} from what you carry` });
    }
    // A carried table can be put down unless one is already right here. It used to be
    // refused within 32 blocks of any table, which left a bot that had mined its way down
    // with a 75 second walk back up to the old one (runs 22, 24 and 25, once each).
    if (inventory.crafting_table && !nearest('crafting_table', 8)) {
      list.push({ name: 'place:crafting_table', about: 'put your crafting table on the ground so tools can be made' });
    }
    for (const direction of Object.keys(DIRECTIONS)) {
      list.push({ name: `explore:${direction}`, about: `walk about 24 blocks ${direction}` });
    }
    return list;
  }

  return {
    name: 'minecraft',
    version: MC_VERSION,

    async reset({ seed, options = {} }) {
      if (bot) { try { bot.quit(); } catch { /* already gone */ } }
      if (server) await server.stop();
      dead = false; gone = null; pending = []; reached = new Set(); walked = 0; lastSpot = null; lastHealth = 20;
      lines = [];
      viewers.clear();
      server = await startServer({
        root, seed, freshWorld: !options.keepWorld,
        log: (line) => {
          lines.push(line);
          // The game is its own judge: its advancements arrive as events, as in the real window.
          const advancement = line.match(new RegExp(`${BOT_NAME} has (?:made the advancement|completed the challenge|reached the goal) \\[(.+?)\\]`));
          if (advancement) pending.push({ kind: 'advancement', detail: { name: advancement[1] } });
          // Anyone else who joins is here to watch: make them a spectator, next to the bot.
          const joined = line.match(/: (\w+) joined the game/);
          if (joined && joined[1] !== BOT_NAME) {
            const viewer = joined[1];
            viewers.add(viewer);
            server.command(`gamemode spectator ${viewer}`);
            server.command(`tp ${viewer} ${BOT_NAME}`);
            // Then put the viewer's camera on the bot, so the view goes wherever it goes, and
            // let the viewer see in the dark: the bot spends a long time underground with no
            // torch, and in the first recording that part of the video was black.
            setTimeout(() => {
              server?.command(`spectate ${BOT_NAME} ${viewer}`);
              server?.command(`effect give ${viewer} minecraft:night_vision infinite 0 true`);
            }, 2500);
          }
          const left = line.match(/: (\w+) left the game/);
          if (left) viewers.delete(left[1]);
        },
      });
      bot = mineflayer.createBot({ host: '127.0.0.1', port: server.port, username: BOT_NAME, auth: 'offline', version: MC_VERSION });
      bot.loadPlugin(pathfinder);
      bot.on('error', () => {});
      bot.on('kicked', (reason) => { gone = `kicked: ${JSON.stringify(reason).slice(0, 120)}`; });
      bot.on('end', (reason) => { gone ??= `disconnected: ${reason}`; });
      bot.on('death', () => { dead = true; pending.push({ kind: 'death', detail: {} }); });
      bot.on('health', () => {
        if (bot.health < lastHealth) pending.push({ kind: 'damage', detail: { amount: Math.round((lastHealth - bot.health) * 10) / 10, health: Math.round(bot.health) } });
        lastHealth = bot.health;
      });
      await within(new Promise((resolve) => bot.once('spawn', resolve)), 60000, 'joining the server');
      await within(bot.waitForChunksToLoad(), 60000, 'loading the land');
      // Walk like a careful player: no pillars, no bridges built from what is carried (that
      // would spend the logs just collected), and no drop long enough to hurt.
      const movements = new Movements(bot);
      movements.allow1by1towers = false;
      movements.scafoldingBlocks = [];
      movements.maxDropDown = 3;
      bot.pathfinder.setMovements(movements);
      bot.pathfinder.thinkTimeout = 15000;   // the default gave up planning a 24 block uphill walk
      // A game window to watch in: started now that there is a server for it to join.
      if (options.window) {
        say('Opening a game window to watch in.');
        spawn(process.execPath, [join(root, 'tools', 'watch_client.mjs'), 'launch'], { stdio: 'ignore', detached: true }).unref();
      }
      if (options.waitForViewer) {
        say(`Waiting up to ${options.waitForViewer} seconds for someone to join and watch.`);
        const deadline = Date.now() + options.waitForViewer * 1000;
        while (Date.now() < deadline && Object.keys(bot.players).length < 2) await pause(1000);
        await pause(3000);
      }
      lastHealth = bot.health;
      startAge = Number(bot.time.age);
      startedAt = Date.now();
      lastSpot = bot.entity.position.clone();
      say('The run begins. The local model chooses; code acts.');
    },

    observe() {
      const p = bot.entity.position;
      if (lastSpot) { walked += p.distanceTo(lastSpot); lastSpot = p.clone(); }
      const mobs = {};
      for (const entity of Object.values(bot.entities)) {
        if (entity === bot.entity || entity.kind !== 'Hostile mobs') continue;
        const distance = Math.round(entity.position.distanceTo(p));
        if (distance <= 24 && (mobs[entity.name] === undefined || distance < mobs[entity.name])) mobs[entity.name] = distance;
      }
      return {
        time: bot.time.timeOfDay < 12500 ? 'day' : 'night',
        health: Math.round(bot.health),
        food: bot.food,
        pos: [Math.round(p.x), Math.round(p.y), Math.round(p.z)],
        carrying: carried(),
        nearest: around(),
        monsters: mobs,
      };
    },

    actions,

    async act(action) {
      const [kind, what] = String(action.name).split(':');
      const before = carried();
      // Bring every viewer's camera back to the bot. One wrong key (Shift) drops a viewer
      // out of the bot's view, and getting back in means finding and clicking the bot.
      for (const viewer of viewers) server.command(`spectate ${BOT_NAME} ${viewer}`);
      say(`chose ${action.name}`);
      let result;
      try {
        if (kind === 'collect') result = await collect(what);
        else if (kind === 'craft') result = await craft(what);
        else if (kind === 'place') result = await placeTable();
        else if (kind === 'explore' && DIRECTIONS[what]) result = await explore(what);
        else result = { ok: false, error: `no such action: ${action.name}` };
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error).slice(0, 160) };
      }
      const events = pending.splice(0);
      events.push(...gainEvents(before, carried(), reached, (milestone) => say(`milestone: ${milestone}`)));
      const stale = dead || gone ? null : await staleCarried().catch(() => null);
      if (stale) events.push({ kind: 'stale_carried', detail: stale });
      if (result.placed && !reached.has('table_placed')) {
        reached.add('table_placed');
        events.push({ kind: 'milestone', detail: { name: 'table_placed' } });
      }
      say(result.ok ? `done: ${JSON.stringify(result.got ?? result.made ?? result.placed ?? result.moved)}` : `failed: ${result.error}`);
      return { result, events };
    },

    // Game ticks since the run began: 20 a second while the server keeps up.
    tick() {
      const age = bot ? Number(bot.time.age) - startAge : NaN;
      return Number.isFinite(age) && age >= 0 ? age : Math.floor((Date.now() - startedAt) / 50);
    },

    ended: () => (dead ? 'death' : gone ? 'disconnected' : null),

    metrics: ({ events }) => runMetrics(events, walked),

    // The rules in words and the kinds of action are the same for both bodies.
    describe: describeText,
    vocabulary: vocabularyList,

    async close() {
      if (server) say('The run is over.');
      await pause(300);
      try { bot?.quit(); } catch { /* already gone */ }
      await pause(300);
      await server?.stop();
      server = null;
      bot = null;
    },
  };
}
