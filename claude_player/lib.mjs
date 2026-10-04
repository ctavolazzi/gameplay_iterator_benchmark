// What a skill, a reflex or the brain can do, as plain functions. player.mjs loads this file
// again whenever it changes, so an edit here takes effect on the next call without
// restarting the player.

import pathfinding from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { diffCarried, fuelNeeded } from './pure.mjs';

const { goals } = pathfinding;
export { goals, Vec3 };

export const HOSTILE = /^(zombie|husk|drowned|zombie_villager|skeleton|stray|bogged|creeper|spider|cave_spider|witch|slime|phantom|pillager|vindicator|silverfish)$/;
export const isHostile = (entity) => !!entity && (entity.type === 'hostile' || HOSTILE.test(entity.name ?? ''));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Monsters come out at about 13000 and the sun burns them from about 23500.
// Turn 3: out at 23600 it met a zombie that had not burned yet. The night now ends at 200.
export const isNight = (time) => time >= 13000 || time < 200;

// What a dug block leaves behind, where that is not the block itself.
const DROPS = {
  stone: 'cobblestone', coal_ore: 'coal', deepslate_coal_ore: 'coal', iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron', copper_ore: 'raw_copper', deepslate_copper_ore: 'raw_copper',
  deepslate: 'cobbled_deepslate', gold_ore: 'raw_gold', deepslate_gold_ore: 'raw_gold',
  diamond_ore: 'diamond', deepslate_diamond_ore: 'diamond', grass_block: 'dirt',
};
const SPOTS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const GROUND = /^(dirt|grass_block|coarse_dirt|podzol|rooted_dirt|stone|andesite|diorite|granite|deepslate|tuff|clay|mud|sandstone|terracotta|calcite|moss_block|cobblestone)$/;
const FILLER = /^(dirt|cobblestone|cobbled_deepslate|stone|netherrack|andesite|diorite|granite|tuff|.*_planks)$/;
// What a player has built or put down, mine or anyone's: never dug through. Turn 4: the
// morning after its first night in bed the journal shows "gained ladder 1" on the way to
// some stone. Someone had put a ladder there.
const FURNITURE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|glass_pane|.*_glass)$/;
const ARMOUR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
const WORN_SLOTS = [5, 6, 7, 8, 45];

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
    .filter((e) => e !== bot.entity && e.position && !['item', 'arrow', 'experience_orb'].includes(e.name) && e.position.distanceTo(from) <= 110)
    .map((e) => ({ name: e.username ?? e.name, d: Math.round(e.position.distanceTo(from)), ...(isHostile(e) && { hostile: true }) }))
    .sort((a, b) => a.d - b.d).slice(0, 24);
  return { blocks: blocks.sort((a, b) => a.d - b.d), creatures,
    under: bot.blockAt(from.offset(0, -1, 0))?.name ?? null,
    sky: bot.blockAt(from.offset(0, 1, 0))?.skyLight ?? null };
}

// signal ends every wait in here when the skill is stopped or runs out of time.
// memory is the player's lasting memory: places, tables that could not be reached.
export function make(bot, signal, memory = {}) {
  const night = () => !!bot.time && isNight(bot.time.timeOfDay);
  if (bot.pathfinder) {
    // The pathfinder gives up thinking after 5 s by default, which a busy machine does not always manage.
    bot.pathfinder.thinkTimeout = 15000;
    // At night a step under the open sky costs a great deal, so a path stays underground when it can.
    if (bot.pathfinder.movements) {
      bot.pathfinder.movements.exclusionAreasStep = night() && !((memory.nightPass ?? 0) > Date.now()) ? [(block) => ((block.skyLight ?? 0) >= 8 ? 40 : 0)] : [];
    }
  }
  // The pathfinder digs through what is in its way. Not through the base's furniture.
  const movements = bot.pathfinder?.movements;
  if (movements && movements.furnitureKept !== FURNITURE.source) {
    for (const block of Object.values(bot.registry.blocksByName)) if (FURNITURE.test(block.name)) movements.blocksCantBreak.add(block.id);
    movements.furnitureKept = FURNITURE.source;
  }
  // The base is not dug through either: its floor, walls and ceiling stay, except the doorway
  // in the middle of the east wall, which is the one way out and is closed again at dusk.
  // (Turn 4: with the brain back on after its first night in bed, its next step was to dig
  // down through its own floor.)
  if (movements) movements.exclusionAreasBreak = memory.base ? [(block) => (inBase(block.position) ? 1000 : 0)] : [];
  function inBase(at) {
    const base = memory.base;
    if (!base || !at) return false;
    const [dx, dy, dz] = [at.x - base.x, at.y - base.y, at.z - base.z];
    if (Math.abs(dx) > 2 || Math.abs(dz) > 2 || dy < -1 || dy > 2) return false;
    return !(dx === 2 && dz === 0 && (dy === 0 || dy === 1));
  }
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
  // Carried and worn together: armour that has been put on is still had.
  const have = () => {
    const out = carried();
    for (const slot of WORN_SLOTS) {
      const item = bot.inventory.slots[slot];
      if (item) out[item.name] = (out[item.name] ?? 0) + item.count;
    }
    return out;
  };
  const find = (pattern) => bot.inventory.items().find((item) => pattern.test(item.name)) ?? null;
  const nameAt = (at) => bot.blockAt(at)?.name ?? null;
  const solid = (at) => bot.blockAt(at)?.boundingBox === 'block';
  const matcher = (name) => name === 'log' ? (b) => b.name.endsWith('_log') : (b) => b.name === name;
  const nearest = (name, distance = 32) => bot.findBlock({ matching: matcher(name), maxDistance: distance });
  const nearestHostile = (distance = 16) => bot.nearestEntity((e) =>
    isHostile(e) && e.position.distanceTo(bot.entity.position) <= distance);
  const others = () => Object.values(bot.players).filter((p) => p.entity && p.username !== bot.username).map((p) => p.entity.position);
  // How close to another player something may be dug: 12 blocks from a person, 3 from a
  // program's player. Turn 4: Codex's player stood by the base, every stone within 12 blocks
  // of it was off limits, and the planner went looking for deepslate instead.
  const crowded = (at) => Object.values(bot.players).some((p) => p.entity && p.username !== bot.username &&
    p.entity.position.distanceTo(at) < (/codex|bot$/i.test(p.username) ? 3 : 12));
  const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

  // Under the open sky. In a closed hole or a tunnel the sky's light does not reach.
  function exposed() {
    const sky = bot.blockAt(bot.entity.position.offset(0, 1, 0))?.skyLight;
    return typeof sky === 'number' ? sky >= 8 : true;
  }

  // A straight line from eye to eye with no block in it.
  async function canSee(entity) {
    const from = bot.entity.position.offset(0, 1.62, 0);
    const line = entity.position.offset(0, (entity.height ?? 1.8) * 0.8, 0).minus(from);
    const hit = await bot.world.raycast(from, line.normalize(), line.norm());
    return !hit;
  }

  async function settle() {
    for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(100);
  }

  // Turn 4: after its first night it stood on the bed and could not leave: every walk
  // ended at once with "moved 0 blocks", because the pathfinder cannot start from a bed.
  async function offTheBed() {
    const feet = bot.entity.position.floored();
    if (!nameAt(feet)?.endsWith('_bed')) return;
    for (const [dx, dz] of [...SIDES, [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const to = feet.offset(dx, 0, dz);
      if (solid(to) || solid(to.offset(0, 1, 0)) || nameAt(to)?.endsWith('_bed')) continue;
      await bot.lookAt(to.offset(0.5, 1.2, 0.5), true);
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await sleep(450);
      bot.clearControlStates();
      await sleep(300);
      if (!nameAt(bot.entity.position.floored())?.endsWith('_bed')) return;
    }
  }

  async function walk(goal, ms = 45000, what = 'walking') {
    check();
    await offTheBed();
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

  const nextToLava = (at) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    .some(([dx, dy, dz]) => nameAt(at.offset(dx, dy, dz)) === 'lava');

  // The nearest block of a kind worth going for: a trunk a person can reach from the ground,
  // nothing touching lava, nothing within 12 blocks of another player (the world is shared).
  // Stone and ore are found through the rock, as the benchmark's player finds them, and the
  // pathfinder digs its way there.
  function reachable(name) {
    const from = bot.entity.position;
    const isLog = name === 'log' || name.endsWith('_log');
    const found = bot.findBlocks({ matching: matcher(name), maxDistance: 48, count: 1024 })
      .filter((at) => !crowded(at) && !inBase(at))
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
    for (const at of found) {
      if (isLog) { const height = trunkHeight(at); if (height === null || height > 3) continue; }
      else if (nextToLava(at)) continue;
      return at;
    }
    return null;
  }

  // Walk to a block and dig it with the best tool carried. The tool is chosen after the
  // walk: the pathfinder changes what is in hand while it digs its own way through.
  async function digAt(at, what = 'block') {
    const far = at.distanceTo(bot.entity.position);
    // A flower or a clump of grass has nothing solid to look at: stand next to it instead.
    const soft = bot.blockAt(at)?.boundingBox === 'empty';
    const goal = soft ? new goals.GoalNear(at.x, at.y, at.z, 2) : new goals.GoalLookAtBlock(at, bot.world, { reach: 4 });
    await walk(goal, Math.min(240000, 20000 + far * 3000), `walking to the ${what}`);
    await settle();
    const block = bot.blockAt(at);
    if (!block || block.name === 'air') throw new Error(`the ${what} is gone`);
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

  // Walk onto dropped items close by, nearest first, until none are left or tries run out.
  async function pickUp(radius = 8, tries = 4) {
    for (let i = 0; i < tries; i++) {
      check();
      const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < radius);
      if (!drop) return;
      await walk(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0), 6000, 'reaching a dropped item').catch(() => {});
      await sleep(300);
    }
  }

  // Dig one block of a kind and pick up what it drops. ok only when the drop is carried.
  async function collectOne(name) {
    const target = reachable(name);
    if (!target) return { ok: false, error: `no ${name} within reach` };
    const before = carried();
    let dug;
    try {
      dug = await digAt(target, name);
    } catch (error) {
      check();   // a stop or a reflex goes up; a walk that failed is this one block's failure
      return { ok: false, error: `${error.message} (the ${name} ${Math.round(target.distanceTo(bot.entity.position))} blocks away)` };
    }
    const wanted = DROPS[dug] ?? dug;
    const gained = () => (carried()[wanted] ?? 0) > (before[wanted] ?? 0);
    await walk(new goals.GoalNear(target.x, target.y, target.z, 1), 10000, 'picking it up').catch(() => {});
    for (let waited = 0; waited < 6 && !gained(); waited++) {
      check();
      await sleep(600);
      if (!gained()) await pickUp(8, 1);
    }
    await sleep(300);
    if (gained()) return { ok: true, got: wanted };
    return { ok: false, error: `dug the ${dug} but did not pick up its ${wanted}` };
  }

  // What a recipe for an item uses, compared with what is carried: for saying why not.
  function shortfall(item) {
    const carry = carried();
    // Of the ways to make it (stone tools take any of three stones), the one closest to hand.
    const ways = bot.recipesAll(item.id, null, true).map((recipe) => {
      const uses = recipe.delta.filter((d) => d.count < 0).map((d) => {
        const name = bot.registry.items[d.id]?.name ?? String(d.id);
        return { name, count: -d.count, missing: Math.max(0, -d.count - (carry[name] ?? 0)) };
      });
      return { recipe, uses, missing: uses.reduce((sum, u) => sum + u.missing, 0) };
    }).sort((x, y) => x.missing - y.missing);
    if (!ways.length) return 'the game has no recipe for it';
    const { recipe, uses } = ways[0];
    return `needs ${uses.map((u) => `${u.count} ${u.name} (have ${carry[u.name] ?? 0})`).join(', ')}${recipe.requiresTable ? ' and a crafting table close by' : ''}`;
  }

  // The nearest crafting table that has not already proved out of reach.
  function tableNear(distance = 32) {
    const from = bot.entity.position;
    // CT's note in chat, 01:37: walk to a table that is already there. One had been written
    // off as out of reach after a single failed walk, and a new one made 2 blocks from it.
    // A table is now written off for two minutes, not for good.
    const bad = (memory.badTables ?? []).filter((b) => Date.now() - (b.at ?? 0) < 120000);
    return bot.findBlocks({ matching: matcher('crafting_table'), maxDistance: distance, count: 8 })
      .filter((at) => !bad.some((b) => same(b, at)))
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from))
      .map((at) => bot.blockAt(at))[0] ?? null;
  }

  // Craft an item, once or several times. "planks" means planks of any wood carried.
  async function craft(want, times = 1) {
    const names = want === 'planks'
      ? Object.keys(bot.registry.itemsByName).filter((name) => name.endsWith('_planks'))
      : [want];
    if (!names.some((name) => bot.registry.itemsByName[name])) return { ok: false, error: `no item called ${want}` };
    const table = tableNear(32);
    for (const name of names) {
      const item = bot.registry.itemsByName[name];
      const recipe = item && bot.recipesFor(item.id, null, 1, table)[0];
      if (!recipe) continue;
      if (recipe.requiresTable && table.position.distanceTo(bot.entity.position) > 3.5) {
        // A table can be in sight and out of reach (turn 0: one 14 blocks off, no path).
        try {
          await walk(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2), 60000, 'walking to the crafting table');
        } catch (error) {
          check();
          (memory.badTables ??= []).push({ ...round(table.position), at: Date.now() });
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
      // The pack is told of a craft a moment after it happens, longer on a busy machine
      // (turn 2: "crafted oak_planks but carry no more of it", and the planks arrived after).
      for (let waited = 0; waited < 8 && (carried()[name] ?? 0) <= (before[name] ?? 0); waited++) await sleep(400);
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
    const carry = carried();
    const fuelCount = fuelNeeded(fuel, count);
    if (fuelCount === null) return { ok: false, error: `${fuel} is not a fuel this skill knows` };
    if ((carry[input] ?? 0) < count) return { ok: false, error: `need ${count} ${input}, have ${carry[input] ?? 0}` };
    if ((carry[fuel] ?? 0) < fuelCount) return { ok: false, error: `need ${fuelCount} ${fuel}, have ${carry[fuel] ?? 0}` };
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

  // Armour and shield carried in the pack and not worn.
  function unworn() {
    return bot.inventory.items().filter((item) => {
      const kind = /_(helmet|chestplate|leggings|boots)$/.exec(item.name)?.[1];
      if (kind) return !bot.inventory.slots[bot.getEquipmentDestSlot(ARMOUR[kind])];
      return item.name === 'shield' && !bot.inventory.slots[45];
    });
  }

  async function wear() {
    const put = [];
    for (const item of unworn()) {
      const kind = /_(helmet|chestplate|leggings|boots)$/.exec(item.name)?.[1];
      await bot.equip(item, kind ? ARMOUR[kind] : 'off-hand');
      put.push(item.name);
      await sleep(250);
    }
    return put;
  }

  // Chase an animal down, and pick up what it leaves.
  async function hunt(name) {
    const from = bot.entity.position;
    // The game tells the player about animals 100 blocks off (who_is_near, turn 4): go that far for one.
    const target = bot.nearestEntity((e) => e.name === name && e.position.distanceTo(from) < 110);
    if (!target) return { ok: false, error: `no ${name} in sight` };
    const weapon = find(/_sword$/) ?? find(/_axe$/);
    if (weapon) await bot.equip(weapon, 'hand');
    const before = carried();
    const deadline = Date.now() + 30000 + target.position.distanceTo(from) * 500;
    let hits = 0;
    let last = target.position.clone();
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
    try {
      while (Date.now() < deadline && bot.entities[target.id]) {
        check();
        last = target.position.clone();
        if (target.position.distanceTo(bot.entity.position) < 3.2) {
          await bot.lookAt(target.position.offset(0, (target.height ?? 1) * 0.6, 0), true);
          bot.attack(target);
          hits += 1;
          await sleep(650);
        } else await sleep(150);
      }
    } finally {
      bot.pathfinder.setGoal(null);
    }
    if (bot.entities[target.id]) return { ok: false, error: `the ${name} got away after ${hits} hits` };
    await sleep(600);
    await walk(new goals.GoalNear(last.x, last.y, last.z, 0), 8000, 'reaching what it dropped').catch(() => {});
    await pickUp(8, 4);
    return { ok: true, hits, gained: diffCarried(before, carried()).gained };
  }

  // Break grass until seeds are carried. About one clump in eight drops them.
  // Turn 2: the first version walked to "look at" each clump, broke none in 150 s and said
  // nothing about why. This one walks next to the clump, and reports how many it broke.
  async function gatherSeeds(count = 1) {
    const start = carried().wheat_seeds ?? 0;
    const keepClear = others();
    const tried = [];
    let broken = 0;
    let lastError = null;
    for (let tries = 0; tries < 40 && (carried().wheat_seeds ?? 0) - start < count; tries++) {
      check();
      const from = bot.entity.position;
      const grass = bot.findBlocks({ matching: (b) => b.name === 'short_grass' || b.name === 'fern' || b.name === 'tall_grass', maxDistance: 32, count: 128 })
        .filter((at) => !tried.some((t) => same(t, at)) && !keepClear.some((other) => other.distanceTo(at) < 6) && Math.abs(at.y - from.y) <= 5)
        .sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0];
      if (!grass) { lastError ??= 'no grass within reach'; break; }
      tried.push(grass);
      try {
        if (grass.distanceTo(from) > 3) await walk(new goals.GoalNear(grass.x, grass.y, grass.z, 2), 12000, 'walking to the grass');
        const block = bot.blockAt(grass);
        if (!block || !/grass|fern/.test(block.name)) continue;
        await within(bot.dig(block, true), 4000, 'breaking the grass');
        broken += 1;
        await sleep(350);
        const seed = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(grass) < 2.5);
        if (seed) await walk(new goals.GoalNear(seed.position.x, seed.position.y, seed.position.z, 0), 5000, 'reaching the seed').catch(() => {});
      } catch (error) {
        check();
        lastError = error.message;
      }
    }
    await sleep(300);
    const got = (carried().wheat_seeds ?? 0) - start;
    return got > 0 ? { ok: true, got, broken } : { ok: false, error: `broke ${broken} clumps of grass and got no seeds${lastError ? `: ${lastError}` : ''}` };
  }

  // Till a block of earth with the hoe and plant a seed in it.
  async function plantSeed() {
    const hoe = find(/_hoe$/);
    const seeds = find(/^wheat_seeds$/);
    if (!hoe || !seeds) return { ok: false, error: `need a hoe and seeds: hoe ${!!hoe}, seeds ${!!seeds}` };
    const from = bot.entity.position;
    const keepClear = others();
    const earth = bot.findBlocks({ matching: (b) => b.name === 'grass_block' || b.name === 'dirt', maxDistance: 8, count: 128 })
      .filter((at) => nameAt(at.offset(0, 1, 0)) === 'air' && at.distanceTo(from) > 1.8 && !keepClear.some((other) => other.distanceTo(at) < 6))
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from))[0];
    if (!earth) return { ok: false, error: 'no bare earth within 8 blocks' };
    await walk(new goals.GoalLookAtBlock(earth, bot.world, { reach: 3 }), 20000, 'walking to the earth');
    await bot.equip(hoe, 'hand');
    await bot.lookAt(earth.offset(0.5, 1, 0.5), true);
    await within(bot.activateBlock(bot.blockAt(earth)), 4000, 'tilling');
    await sleep(500);
    if (nameAt(earth) !== 'farmland') return { ok: false, error: `tilled and the block is still ${nameAt(earth)}` };
    await bot.equip(seeds, 'hand');
    await within(bot.placeBlock(bot.blockAt(earth), new Vec3(0, 1, 0)), 4000, 'planting').catch(() => {});
    await sleep(400);
    const crop = nameAt(earth.offset(0, 1, 0));
    return crop === 'wheat' ? { ok: true, at: round(earth) } : { ok: false, error: `planted and the block above is ${crop}` };
  }

  // Four blocks closed around and one overhead.
  function enclosed() {
    const feet = bot.entity.position.floored();
    return solid(feet.offset(0, 2, 0)) && SIDES.every(([dx, dz]) => solid(feet.offset(dx, 0, dz)) && solid(feet.offset(dx, 1, dz)));
  }

  // A place to stand with three blocks of real ground under it, away from monsters and
  // other players. The world's spawn point is in a treetop, where a hole cannot be dug.
  function groundSpot() {
    const feet = bot.entity.position.floored();
    const foes = Object.values(bot.entities).filter(isHostile).map((e) => e.position);
    const keepClear = others();
    let best = null;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = -12; dy <= 2; dy++) {
      const at = feet.offset(dx, dy, dz);
      if (solid(at) || solid(at.offset(0, 1, 0))) continue;
      // Turn 3: it dug in on a river bed and lost 13.5 health drowning. Nowhere wet.
      if ([[0, 0], ...SIDES].some(([wx, wz]) => [0, 1, 2].some((up) => /water|lava/.test(nameAt(at.offset(wx, up, wz)) ?? '')))) continue;
      if (![1, 2, 3].every((down) => GROUND.test(nameAt(at.offset(0, -down, 0)) ?? ''))) continue;
      if (!SIDES.every(([sx, sz]) => solid(at.offset(sx, -1, sz)) && solid(at.offset(sx, -2, sz)))) continue;
      if (keepClear.some((other) => other.distanceTo(at) < 4)) continue;
      const cost = at.distanceTo(feet) + (foes.some((foe) => foe.distanceTo(at) < 6) ? 12 : 0);
      if (!best || cost < best.cost) best = { at, cost };
    }
    return best?.at ?? null;
  }

  // The night shelter: three blocks straight down, one block put back overhead.
  async function digIn() {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    await sleep(300);
    const spot = groundSpot();
    if (!spot) return { ok: false, error: 'no ground to dig into within 8 blocks' };
    await walk(new goals.GoalBlock(spot.x, spot.y, spot.z), 20000, 'walking to the ground').catch(() => {});
    await settle();
    const start = bot.entity.position.floored();
    for (let depth = 0; depth < 3; depth++) {
      const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
      if (under?.boundingBox !== 'block' || nextToLava(under.position)) break;
      const tool = bot.pathfinder.bestHarvestTool(under);
      if (tool) await bot.equip(tool, 'hand');
      await within(bot.dig(under, true), 15000, 'digging in');
      await sleep(400);
      await settle();
    }
    const feet = bot.entity.position.floored();
    const cap = feet.offset(0, 2, 0);
    if (start.y - feet.y < 2) return { ok: false, error: `only got ${start.y - feet.y} blocks down` };
    if (!solid(cap)) {
      const filler = find(FILLER);
      if (!filler) return { ok: false, error: 'nothing carried to close the hole with' };
      await bot.equip(filler, 'hand');
      for (const [dx, dz] of SIDES) {
        const wall = bot.blockAt(cap.offset(dx, 0, dz));
        if (wall?.boundingBox !== 'block') continue;
        await within(bot.placeBlock(wall, new Vec3(-dx, 0, -dz)), 4000, 'closing the hole').catch(() => {});
        await sleep(250);
        if (solid(cap)) break;
      }
    }
    return enclosed() ? { ok: true, note: `${start.y - feet.y} blocks down and closed` } : { ok: false, error: 'the hole is not closed' };
  }

  // Put a carried thing on the floor of one exact cell. Looks at the world after, not the reply.
  async function placeAt(itemName, cell) {
    const item = find(new RegExp(`^${itemName}$`));
    if (!item) return { ok: false, error: `you carry no ${itemName}` };
    const here = bot.blockAt(cell);
    const below = bot.blockAt(cell.offset(0, -1, 0));
    if (here && here.name !== 'air') return { ok: here.name === itemName, placed: here.name, at: round(cell), error: `${here.name} is already there` };
    if (below?.boundingBox !== 'block') return { ok: false, error: 'nothing under it to stand it on' };
    let failure = null;
    await bot.equip(item, 'hand');
    await within(bot.placeBlock(below, new Vec3(0, 1, 0)), 6000, `placing the ${itemName}`).catch((error) => { failure = error.message; });
    await sleep(350);
    const now = bot.blockAt(cell);
    return now && now.name !== 'air' ? { ok: true, placed: now.name, at: round(cell) } : { ok: false, error: failure ?? 'nothing appeared' };
  }

  // Put a block of filler into an empty cell, against whichever neighbour is solid.
  async function fill(cell) {
    if (solid(cell)) return true;
    const filler = find(FILLER);
    if (!filler) return false;
    await bot.equip(filler, 'hand');
    for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      const against = bot.blockAt(cell.offset(dx, dy, dz));
      if (against?.boundingBox !== 'block') continue;
      await within(bot.placeBlock(against, new Vec3(-dx, -dy, -dz)), 4000, 'closing a gap').catch(() => {});
      await sleep(200);
      if (solid(cell)) return true;
    }
    return false;
  }

  // Dig out every block in a list of cells, from where the player stands. Stops at lava or water.
  async function digOut(cells) {
    let dug = 0;
    for (const cell of cells) {
      check();
      const block = bot.blockAt(cell);
      if (!block || block.boundingBox === 'empty') {
        if (/lava|water/.test(block?.name ?? '')) return { ok: false, dug, error: `${block.name} in the room` };
        continue;
      }
      if (FURNITURE.test(block.name)) continue;
      if (nextToLava(cell)) return { ok: false, dug, error: 'lava beside the room' };
      const tool = bot.pathfinder.bestHarvestTool(block);
      if (tool) await bot.equip(tool, 'hand');
      await within(bot.dig(block, true), 20000, `digging out ${block.name}`);
      dug += 1;
    }
    return { ok: true, dug };
  }

  // Get into the nearest bed at the first moment the game allows it, then get up again.
  async function sleepInBed() {
    const bed = bot.findBlock({ matching: (b) => b.name.endsWith('_bed'), maxDistance: 24 });
    if (!bed) return { ok: false, error: 'no bed within 24 blocks' };
    await walk(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2), 40000, 'walking to the bed');
    const deadline = Date.now() + 70000;
    while (bot.time.timeOfDay > 11000 && bot.time.timeOfDay < 12541 && Date.now() < deadline) { check(); await sleep(50); }
    const time = bot.time.timeOfDay;
    try {
      await within(bot.sleep(bot.blockAt(bed.position)), 8000, 'getting into bed');
    } catch (error) {
      return { ok: false, error: `${error.message} (time ${time})` };
    }
    await sleep(3000);
    await bot.wake().catch(() => {});
    return { ok: true, at: round(bed.position), time };
  }

  return { inBase, crowded, placeAt, fill, digOut, sleepInBed, solid, night, exposed, canSee, enclosed, digIn, check, within, sleep, carried, have, find, nameAt, nearest,
    nearestHostile, settle, walk, reachable, digAt, pickUp, collectOne, tableNear, craft, placeNear, smelt, eat,
    unworn, wear, hunt, gatherSeeds, plantSeed, goals, Vec3, round, isHostile };
}
