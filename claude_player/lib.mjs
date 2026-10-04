// What a skill can do, as plain functions. player.mjs loads this file again whenever it
// changes, so an edit here takes effect on the next skill call without restarting the player.

import pathfinding from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { fuelNeeded } from './pure.mjs';

const { goals } = pathfinding;
export { goals, Vec3 };

export const HOSTILE = /^(zombie|husk|drowned|zombie_villager|skeleton|stray|bogged|creeper|spider|cave_spider|witch|slime|phantom|pillager|vindicator|silverfish)$/;
export const isHostile = (entity) => !!entity && (entity.type === 'hostile' || HOSTILE.test(entity.name ?? ''));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What a dug block leaves behind, where that is not the block itself.
const DROPS = {
  stone: 'cobblestone', coal_ore: 'coal', deepslate_coal_ore: 'coal', iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron', copper_ore: 'raw_copper', deepslate: 'cobbled_deepslate',
  diamond_ore: 'diamond', deepslate_diamond_ore: 'diamond', grass_block: 'dirt',
};
const NEEDS_PICKAXE = /stone|_ore$|deepslate|furnace|andesite|diorite|granite/;
const SPOTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];

const round = (v) => ({ x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) });

// Nearest block of each kind worth knowing about, and every creature close by.
export function observe(bot) {
  const from = bot.entity.position;
  const kinds = [/_log$/, /^crafting_table$/, /^furnace$/, /^stone$/, /coal_ore$/, /iron_ore$/, /diamond_ore$/,
    /^water$/, /^lava$/, /_bed$/, /^chest$/, /^sand$/, /^gravel$/, /^short_grass$/, /^sugar_cane$/,
    /^(wheat|carrots|potatoes|beetroots)$/, /^(pumpkin|melon)$/];
  const blocks = [];
  for (const kind of kinds) {
    const block = bot.findBlock({ matching: (b) => kind.test(b.name), maxDistance: 32 });
    if (block) blocks.push({ name: block.name, d: Math.round(block.position.distanceTo(from)), at: round(block.position) });
  }
  const creatures = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && e.position && e.name !== 'item' && e.position.distanceTo(from) <= 24)
    .map((e) => ({ name: e.username ?? e.name, d: Math.round(e.position.distanceTo(from)), ...(isHostile(e) && { hostile: true }) }))
    .sort((a, b) => a.d - b.d).slice(0, 16);
  return { blocks: blocks.sort((a, b) => a.d - b.d), creatures,
    time: bot.time ? { timeOfDay: bot.time.timeOfDay, isDay: bot.time.isDay } : null,
    under: bot.blockAt(from.offset(0, -1, 0))?.name ?? null };
}

// signal ends every wait in here when the skill is stopped or runs out of time.
export function make(bot, signal) {
  // The pathfinder gives up thinking after 5 s by default, which a busy machine does not always manage.
  if (bot.pathfinder) bot.pathfinder.thinkTimeout = 15000;
  const check = () => { if (signal?.aborted) throw new Error(signal.reason?.message ?? 'stopped'); };
  const within = (promise, ms, what) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`took too long ${what}`)), ms);
    const stop = () => reject(new Error(`${signal.reason?.message ?? 'stopped'} while ${what}`));
    signal?.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    });
  });

  const carried = () => {
    const out = {};
    for (const item of bot.inventory.items()) out[item.name] = (out[item.name] ?? 0) + item.count;
    return out;
  };
  const find = (pattern) => bot.inventory.items().find((item) => pattern.test(item.name)) ?? null;
  const nameAt = (at) => bot.blockAt(at)?.name ?? null;
  const matcher = (name) => name === 'log' ? (b) => b.name.endsWith('_log') : (b) => b.name === name;
  const nearest = (name, distance = 32) => bot.findBlock({ matching: matcher(name), maxDistance: distance });
  const nearestHostile = (distance = 16) => bot.nearestEntity((e) =>
    isHostile(e) && e.position.distanceTo(bot.entity.position) <= distance);

  async function settle() {
    for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(100);
  }

  async function walk(goal, ms = 45000, what = 'walking') {
    check();
    try {
      await within(bot.pathfinder.goto(goal), ms, what);
    } catch (error) {
      bot.pathfinder.setGoal(null);
      throw error;
    }
  }

  // How many logs lie between this log and the ground under its trunk. null for a branch,
  // which has leaves or air under it: going after those cost the benchmark fall damage.
  function trunkHeight(at) {
    let height = 0;
    let under = at.offset(0, -1, 0);
    while (height < 12 && nameAt(under)?.endsWith('_log')) { height += 1; under = under.offset(0, -1, 0); }
    const base = bot.blockAt(under);
    return base && base.boundingBox === 'block' && !base.name.endsWith('_leaves') ? height : null;
  }

  // The nearest block of a kind that someone standing on the ground can get to.
  function reachable(name) {
    const from = bot.entity.position;
    const feet = Math.floor(from.y);
    // The world is shared: nothing within 12 blocks of another player is dug.
    const others = Object.values(bot.players).filter((p) => p.entity && p.username !== bot.username).map((p) => p.entity.position);
    const found = bot.findBlocks({ matching: matcher(name), maxDistance: 48, count: 256 })
      .filter((at) => !others.some((other) => other.distanceTo(at) < 12));
    const closest = (list) => list.sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0] ?? null;
    if (name === 'log' || name.endsWith('_log')) {
      return closest(found.filter((at) => { const h = trunkHeight(at); return h !== null && h <= 3; }));
    }
    const lowest = NEEDS_PICKAXE.test(name) ? feet - 20 : feet - 6;
    return closest(found.filter((at) => at.y <= feet + 2 && at.y >= lowest));
  }

  // Walk to a block and dig it with the best tool carried. The tool is chosen after the
  // walk: the pathfinder changes what is in hand while it digs its own way through.
  async function digAt(at, what = 'block') {
    await walk(new goals.GoalLookAtBlock(at, bot.world, { reach: 4 }), 45000, `walking to the ${what}`);
    await settle();
    const block = bot.blockAt(at);
    if (!block || block.boundingBox === 'empty') throw new Error(`the ${what} is gone`);
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    if (!block.canHarvest(bot.heldItem?.type ?? null)) throw new Error(`nothing carried can harvest ${block.name}`);
    try {
      await within(bot.dig(block, true), 40000, `digging the ${what}`);
    } catch (error) {
      bot.stopDigging();
      throw error;
    }
    return block.name;
  }

  // Dig one block of a kind and pick up what it drops. ok only when the drop is carried.
  async function collectOne(name) {
    const target = reachable(name);
    if (!target) return { ok: false, error: `no ${name} within reach of the ground nearby` };
    const before = carried();
    const dug = await digAt(target, name);
    const wanted = DROPS[dug] ?? dug;
    const gained = () => (carried()[wanted] ?? 0) > (before[wanted] ?? 0);
    await walk(new goals.GoalNear(target.x, target.y, target.z, 1), 10000, 'picking it up').catch(() => {});
    for (let waited = 0; waited < 6 && !gained(); waited++) {
      check();
      await sleep(600);
      if (gained()) break;
      const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 8);
      if (drop) await walk(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0), 6000, 'reaching the dropped item').catch(() => {});
    }
    await sleep(300);
    if (gained()) return { ok: true, got: wanted };
    return { ok: false, error: `dug the ${dug} but did not pick up its ${wanted}` };
  }

  // What a recipe for an item uses, compared with what is carried: for saying why not.
  function shortfall(item) {
    const have = carried();
    // Of the ways to make it (stone tools take any of three stones), the one closest to hand.
    const ways = bot.recipesAll(item.id, null, true).map((recipe) => {
      const uses = recipe.delta.filter((d) => d.count < 0).map((d) => {
        const name = bot.registry.items[d.id]?.name ?? String(d.id);
        return { name, count: -d.count, missing: Math.max(0, -d.count - (have[name] ?? 0)) };
      });
      return { recipe, uses, missing: uses.reduce((sum, u) => sum + u.missing, 0) };
    }).sort((x, y) => x.missing - y.missing);
    if (!ways.length) return 'the game has no recipe for it';
    const { recipe, uses } = ways[0];
    return `needs ${uses.map((u) => `${u.count} ${u.name} (have ${have[u.name] ?? 0})`).join(', ')}${recipe.requiresTable ? ' and a crafting table within 32 blocks' : ''}`;
  }

  // Craft an item, once or several times. "planks" means planks of any wood carried.
  async function craft(want, times = 1) {
    const names = want === 'planks'
      ? Object.keys(bot.registry.itemsByName).filter((name) => name.endsWith('_planks'))
      : [want];
    if (!names.some((name) => bot.registry.itemsByName[name])) return { ok: false, error: `no item called ${want}` };
    const table = nearest('crafting_table', 32);
    for (const name of names) {
      const item = bot.registry.itemsByName[name];
      const recipe = item && bot.recipesFor(item.id, null, 1, table)[0];
      if (!recipe) continue;
      if (recipe.requiresTable && table.position.distanceTo(bot.entity.position) > 3.5) {
        // A table can be in sight and out of reach (iteration 0: one 14 blocks off, no path).
        try {
          await walk(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), 75000, 'walking to the crafting table');
        } catch (error) {
          check();
          return { ok: false, error: `could not reach the crafting table ${Math.round(table.position.distanceTo(bot.entity.position))} blocks away: ${error.message}` };
        }
      }
      const before = carried();
      for (let done = 0; done < times; done++) {
        check();
        try {
          await within(bot.craft(recipe, 1, recipe.requiresTable ? table : null), 15000, `crafting ${name}`);
        } catch (error) {
          if (done === 0) throw error;
          break;
        }
        await sleep(500);
      }
      const made = (carried()[name] ?? 0) - (before[name] ?? 0);
      return made > 0 ? { ok: true, made: { [name]: made } } : { ok: false, error: `crafted ${name} but carry no more of it` };
    }
    return { ok: false, error: `cannot craft ${want}: ${shortfall(bot.registry.itemsByName[names[0]])}` };
  }

  // Put a carried block on the ground within 2 blocks. Returns where it went.
  async function placeNear(itemName) {
    const item = find(new RegExp(`^${itemName}$`));
    if (!item) return { ok: false, error: `you carry no ${itemName}` };
    await settle();
    const base = bot.entity.position.floored();
    let tried = 0;
    let lastError = 'no solid ground with open space above it within 2 blocks';
    for (const [dx, dz] of SPOTS) {
      for (const dy of [-1, 0, -2]) {
        const ground = bot.blockAt(base.offset(dx, dy, dz));
        const above = bot.blockAt(base.offset(dx, dy + 1, dz));
        const open = above && above.boundingBox === 'empty' && !/water|lava/.test(above.name);
        if (ground?.boundingBox !== 'block' || !open || tried >= 4) continue;
        tried += 1;
        check();
        try {
          await bot.equip(item, 'hand');
          await within(bot.placeBlock(ground, new Vec3(0, 1, 0)), 8000, `placing the ${itemName}`);
        } catch (error) {
          lastError = String(error?.message ?? error).slice(0, 120);
        }
        // Read the world, not the reply: the server has placed blocks whose confirmation never came.
        await sleep(300);
        const now = bot.blockAt(above.position);
        if (now && now.boundingBox !== 'empty') return { ok: true, placed: now.name, at: round(above.position) };
      }
    }
    return { ok: false, error: `could not place the ${itemName} (${tried} spots tried): ${lastError}` };
  }

  // Smelt in the nearest furnace and take the result out.
  async function smelt(input, fuel, count = 1) {
    const block = nearest('furnace', 32);
    if (!block) return { ok: false, error: 'no furnace within 32 blocks' };
    const have = carried();
    const fuelCount = fuelNeeded(fuel, count);
    if (fuelCount === null) return { ok: false, error: `${fuel} is not a fuel this skill knows` };
    if ((have[input] ?? 0) < count) return { ok: false, error: `need ${count} ${input}, have ${have[input] ?? 0}` };
    if ((have[fuel] ?? 0) < fuelCount) return { ok: false, error: `need ${fuelCount} ${fuel}, have ${have[fuel] ?? 0}` };
    await walk(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2), 60000, 'walking to the furnace');
    const furnace = await within(bot.openFurnace(bot.blockAt(block.position)), 8000, 'opening the furnace');
    try {
      await furnace.putFuel(bot.registry.itemsByName[fuel].id, null, fuelCount);
      await furnace.putInput(bot.registry.itemsByName[input].id, null, count);
      const deadline = Date.now() + (count * 11 + 10) * 1000;
      while (Date.now() < deadline && (furnace.outputItem()?.count ?? 0) < count) {
        check();
        await sleep(500);
      }
      const out = furnace.outputItem();
      if (!out) return { ok: false, error: 'nothing came out of the furnace in time' };
      await furnace.takeOutput();
      return { ok: out.count >= count, made: { [out.name]: out.count } };
    } finally {
      furnace.close();
    }
  }

  async function eat() {
    const foods = bot.registry.foodsByName ?? {};
    const food = bot.inventory.items()
      .filter((i) => foods[i.name] && !/rotten_flesh|spider_eye|poisonous|pufferfish|^chicken$/.test(i.name))
      .sort((a, b) => (foods[b.name].foodPoints ?? 0) - (foods[a.name].foodPoints ?? 0))[0];
    if (!food) return { ok: false, error: 'no food carried' };
    await bot.equip(food, 'hand');
    await within(bot.consume(), 6000, 'eating');
    return { ok: true, ate: food.name };
  }

  return { check, within, sleep, carried, find, nameAt, nearest, nearestHostile, settle, walk, reachable,
    digAt, collectOne, craft, placeNear, smelt, eat, goals, Vec3, round, isHostile };
}
