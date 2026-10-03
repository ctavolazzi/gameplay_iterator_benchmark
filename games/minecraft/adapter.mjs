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
import { MC_VERSION, startServer } from './server.mjs';

const { pathfinder, Movements, goals } = pathfinderPackage;
const { Vec3 } = vec3Package;

export const defaults = { seed: '7040093665601660210', budget: { ticks: 12000, calls: 40 } };
// A new playbook is tried on one short live run before it is adopted.
export const validation = { seeds: [defaults.seed], budget: { ticks: 3000, calls: 5 } };

const BOT_NAME = 'LocalModel';
const DIRECTIONS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const NEEDS_PICKAXE = /^(stone|cobblestone|coal_ore|iron_ore|copper_ore|deepslate)$/;
const COLLECTIBLE = /_log$|^stone$|^cobblestone$|^coal_ore$|^iron_ore$|^sand$/;
const NOTICED = /_log$|^stone$|^coal_ore$|^iron_ore$|^water$|^crafting_table$|^sand$/;
const CRAFTABLE = [
  'planks', 'stick', 'crafting_table', 'wooden_pickaxe', 'wooden_axe', 'wooden_sword',
  'stone_pickaxe', 'stone_axe', 'stone_sword', 'furnace', 'torch',
];
const MILESTONES = [
  [/_log$/, 'first_log'], [/_planks$/, 'planks'], [/^crafting_table$/, 'crafting_table'], [/^stick$/, 'sticks'],
  [/^wooden_pickaxe$/, 'wooden_pickaxe'], [/^cobblestone$/, 'cobblestone'], [/^stone_pickaxe$/, 'stone_pickaxe'],
  [/^coal$/, 'coal'], [/^furnace$/, 'furnace'], [/^raw_iron$/, 'iron'],
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} took more than ${ms / 1000} seconds`)), ms))]);

export function createAdapter({ root } = {}) {
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

  const say = (text) => server?.command(`say ${text}`);
  const carried = () => {
    const out = {};
    for (const item of bot.inventory.items()) out[item.name] = (out[item.name] ?? 0) + item.count;
    return out;
  };
  const has = (pattern) => bot.inventory.items().find((item) => pattern.test(item.name));
  const nearest = (name, distance = 32) =>
    bot.findBlock({ matching: (block) => block.name === name, maxDistance: distance });

  // Nearest block of each kind worth knowing about: name -> how many blocks away.
  function around() {
    const from = bot.entity.position;
    const best = {};
    for (const at of bot.findBlocks({ matching: (block) => NOTICED.test(block.name), maxDistance: 32, count: 600 })) {
      const name = bot.blockAt(at).name;
      const distance = Math.round(at.distanceTo(from));
      if (best[name] === undefined || distance < best[name]) best[name] = distance;
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
  function reachable(name) {
    const from = bot.entity.position;
    const feet = Math.floor(from.y);
    return bot.findBlocks({ matching: (block) => block.name === name, maxDistance: 48, count: 64 })
      .filter((at) => at.y <= feet + 2 && at.y >= feet - 6)
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0] ?? null;
  }

  async function collect(name) {
    const target = reachable(name);
    if (!target) return { ok: false, error: `no ${name} within reach of the ground nearby` };
    const tool = NEEDS_PICKAXE.test(name) ? has(/_pickaxe$/) : has(/_axe$/);
    if (tool) await bot.equip(tool, 'hand');
    const before = carried();
    await walkTo(new goals.GoalLookAtBlock(target, bot.world), 45000, `walking to the ${name}`);
    await settle();
    try {
      await within(bot.dig(bot.blockAt(target)), 40000, `digging the ${name}`);
    } catch (error) {
      bot.stopDigging();
      throw error;
    }
    await walkTo(new goals.GoalNear(target.x, target.y, target.z, 1), 10000, 'picking it up').catch(() => {});
    await pause(1200);
    const after = carried();
    const got = Object.fromEntries(Object.keys(after).filter((k) => after[k] > (before[k] ?? 0)).map((k) => [k, after[k] - (before[k] ?? 0)]));
    return Object.keys(got).length ? { ok: true, got } : { ok: false, error: `dug the ${name} but picked nothing up` };
  }

  async function craft(want) {
    const found = recipeFor(want);
    if (!found) return { ok: false, error: `cannot craft ${want} with what you carry` };
    if (found.table && found.table.position.distanceTo(bot.entity.position) > 3.5) {
      await walkTo(new goals.GoalLookAtBlock(found.table.position, bot.world), 30000, 'walking to the crafting table');
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
      const target = reachable(name);
      if (!target) continue;
      const distance = Math.round(target.distanceTo(bot.entity.position));
      list.push({ name: `collect:${name}`, about: `walk ${distance} blocks to the nearest ${name} and dig one` });
    }
    for (const want of CRAFTABLE) {
      const found = recipeFor(want);
      if (found) list.push({ name: `craft:${want}`, about: `make ${want} from what you carry` });
    }
    if (inventory.crafting_table && !nearest('crafting_table', 32)) {
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
      server = await startServer({
        root, seed, freshWorld: !options.keepWorld,
        log: (line) => {
          // Anyone else who joins is here to watch: make them a spectator, next to the bot.
          const joined = line.match(/: (\w+) joined the game/);
          if (joined && joined[1] !== BOT_NAME) {
            server.command(`gamemode spectator ${joined[1]}`);
            server.command(`tp ${joined[1]} ${BOT_NAME}`);
          }
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
      const after = carried();
      for (const [item, count] of Object.entries(after)) {
        if (count <= (before[item] ?? 0)) continue;
        events.push({ kind: 'item', detail: { item, count } });
        for (const [pattern, milestone] of MILESTONES) {
          if (pattern.test(item) && !reached.has(milestone)) {
            reached.add(milestone);
            events.push({ kind: 'milestone', detail: { name: milestone } });
            say(`milestone: ${milestone}`);
          }
        }
      }
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

    metrics({ events }) {
      const items = new Set();
      const firstTicks = {};
      let damage = 0;
      let milestones = 0;
      for (const e of events) {
        if (e.kind === 'item') items.add(e.detail.item);
        if (e.kind === 'damage') damage += e.detail.amount;
        if (e.kind === 'milestone') { milestones += 1; firstTicks[`tick_of_${e.detail.name}`] = e.tick; }
      }
      return { unique_items: items.size, milestones, distance_walked: Math.round(walked), damage_taken: Math.round(damage * 10) / 10, ...firstTicks };
    },

    describe() {
      return [
        'You are a player in Minecraft survival, starting with nothing.',
        'Get as far as you can: wood, then planks, a crafting table, sticks, a wooden pickaxe, then stone and a stone pickaxe.',
        'collect digs one block and picks it up. craft makes an item from what you carry.',
        'Tools need a crafting table placed on the ground nearby. Stone needs a pickaxe.',
        'At night monsters come. If your health reaches 0 the run ends.',
      ].join(' ');
    },

    // The kinds of action this game has. The exact names depend on what is nearby and what
    // is carried; a skill reads them from api.primitives().
    vocabulary() {
      return [
        { name: 'collect:<block>', about: 'walk to the nearest block of that kind and dig one, for example collect:oak_log or collect:stone. Offered only for blocks within 32 blocks; stone and ores only when a pickaxe is carried. Result: { ok, got: { item: count } }' },
        { name: 'craft:<item>', about: `make one of: ${CRAFTABLE.join(', ')}. Offered only when what is carried is enough (and a crafting table is within 24 blocks for tools). craft:planks turns 1 log into 4 planks. Result: { ok, made }` },
        { name: 'place:crafting_table', about: 'put a carried crafting table on the ground. Offered when one is carried and none is within 24 blocks.' },
        { name: 'explore:<north|south|east|west>', about: 'walk about 24 blocks that way. Always offered.' },
        { name: '(observation)', about: 'observe() gives { time: day or night, health 0 to 20, food, pos, carrying: { item: count }, nearest: { block: distance }, monsters: { name: distance } }' },
      ];
    },

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
