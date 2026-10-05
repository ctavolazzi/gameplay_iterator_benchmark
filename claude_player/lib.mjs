// What a skill, a reflex or the brain can do, as plain functions. player.mjs loads this file
// again whenever it changes, so an edit here takes effect on the next call without
// restarting the player.

import pathfinding from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { diffCarried, fuelNeeded, shutIn } from './pure.mjs';

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
// What a gap is closed with. Not planks: planks are on the list of built things that are never
// dug through, and a doorway closed with them shut the player in its own base (turn 8).
const FILLER = /^(dirt|cobblestone|cobbled_deepslate|stone|netherrack|andesite|diorite|granite|tuff)$/;
// What a player has built or put down, mine or anyone's: never dug through. Turn 4: the
// morning after its first night in bed the journal shows "gained ladder 1" on the way to
// some stone. Someone had put a ladder there.
const FURNITURE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|glass_pane|.*_glass)$/;
const ARMOUR = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
// What is not worth a place in the chest or, past a stack of the building stones, in the pack.
export const JUNK = /^(cobblestone|cobbled_deepslate|stone|tuff|diorite|andesite|granite|gravel|dirt|leaf_litter|feather|rotten_flesh|egg|pumpkin_seeds|flint|white_banner|ladder|.*_sapling)$/;
const KEPT_ON_THE_PLAYER = /^(stick|torch|coal|charcoal|bucket|water_bucket|.*_log|.*_planks|cooked_.*|bread|wheat_seeds|.*_bed|crafting_table|furnace|shield)$/;
const WORN_SLOTS = [5, 6, 7, 8, 45];

// What to take out of the chest to be fit to go out again: [[name, count]]. have is what the
// player carries and wears, there is what the chest holds. A better piece of each kind of
// armour, a better pickaxe and sword, a shield, something to eat, and diamonds for the diamond
// things it will still be without. Death 22 left it cutting wood for a wooden pickaxe beside a
// chest that held 97 diamonds and an iron set.
const MATERIALS = ['wooden', 'leather', 'stone', 'chainmail', 'golden', 'iron', 'diamond', 'netherite'];
const DIAMONDS_FOR = { _pickaxe: 3, _sword: 2, _helmet: 5, _chestplate: 8, _leggings: 7, _boots: 4 };
const rank = (name) => MATERIALS.indexOf(name.split('_')[0]);
const bestOfKind = (things, kind) => Object.keys(things).filter((name) => name.endsWith(kind) && things[name] > 0).sort((a, b) => rank(b) - rank(a))[0] ?? null;
// How many diamonds the diamond things the player is without would take. These are not
// spares: at 09:21:55 on 2026-10-04 the 26 just taken from the chest for armour were put
// back into it two seconds later.
export function diamondsWanted(have) {
  let diamonds = 0;
  for (const [kind, cost] of Object.entries(DIAMONDS_FOR)) {
    if (rank(bestOfKind(have, kind) ?? '') < MATERIALS.indexOf('diamond')) diamonds += cost;
  }
  return diamonds;
}
// What to do in bed with the night going on: stay when it was asked to sleep or when someone
// else is in a bed too; otherwise ask, three times, and then leave.
export function inBed({ stay, othersAsleep, asked }) {
  if (stay || othersAsleep > 0) return 'stay';
  return asked < 3 ? 'ask' : 'leave';
}
export function kitFrom(have, there) {
  const take = [];
  const after = { ...have };
  for (const kind of Object.keys(DIAMONDS_FOR)) {
    const mine = bestOfKind(have, kind), theirs = bestOfKind(there, kind);
    if (theirs && (!mine || rank(theirs) > rank(mine))) { take.push([theirs, 1]); after[theirs] = 1; }
  }
  if (!have.shield && there.shield) take.push(['shield', 1]);
  const short = Math.min(there.diamond ?? 0, Math.max(0, diamondsWanted(after) - (have.diamond ?? 0)));
  if (short > 0) take.push(['diamond', short]);
  const eaten = Object.entries(have).filter(([name]) => /^cooked_|^bread$/.test(name)).reduce((sum, [, n]) => sum + n, 0);
  const food = Object.keys(there).find((name) => /^cooked_|^bread$/.test(name));
  if (eaten < 4 && food) take.push([food, Math.min(there[food], 8)]);
  return take;
}

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
      const rules = night() && !memory.pass?.night ? [(block) => ((block.skyLight ?? 0) >= 8 ? 40 : 0)] : [];
      // Thrown-away stone is picked up again by walking over it (turn 15: 264 blocks dropped
      // and 256 of them back in the pack a minute later). For the 5 minutes until it is gone,
      // a step within 2 blocks of where it lies costs enough to go round.
      const heaps = (memory.junk ?? []).filter((heap) => heap.until > Date.now());
      if (heaps.length) rules.push((block) => (block.position && heaps.some((h) => Math.abs(h.x - block.position.x) <= 2 && Math.abs(h.z - block.position.z) <= 2 && Math.abs(h.y - block.position.y) <= 2) ? 25 : 0));
      bot.pathfinder.movements.exclusionAreasStep = rules;
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
  // Turn 7: four of twelve deaths were drowning. A path through water now costs six times a path round it.
  if (movements) movements.liquidCost = 6;
  if (movements) movements.exclusionAreasBreak = memory.base ? [(block) => (inBase(block.position) ? 1000 : 0)] : [];
  // Nor does a path dig or put a block down in a field the player has built (memory.farmField,
  // set by skills/work.mjs). On 2026-10-04 the way into the fenced farm, and out of it, was a
  // block of earth set down by the fence and a hop over on to the tilled ground. The field is
  // entered by its gate (skills/build_farm.mjs through()); the pathfinder's own gate opening
  // (canOpenDoors) is left off, because it ends the process.
  const field = memory.farmField;
  const inField = (at) => !!field && !!at && at.x >= field.x - 1 && at.x <= field.x + 21 && at.z >= field.z - 1 && at.z <= field.z + 11
    && at.y >= field.level - 2 && at.y <= field.level + 5;
  if (movements && field) {
    movements.exclusionAreasBreak = [...movements.exclusionAreasBreak, (block) => (inField(block.position) ? 1000 : 0)];
    movements.exclusionAreasPlace = [(block) => (inField(block.position) ? 1000 : 0)];
  }
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
  // The best of a kind that is carried: a diamond sword before a stone one. Death 21 was fought
  // with the stone sword while the diamond sword stayed in the pack.
  const GRADES = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
  const bestOf = (ending) => bot.inventory.items().filter((item) => item.name.endsWith(ending))
    .sort((x, y) => GRADES.findIndex((g) => x.name.startsWith(g)) - GRADES.findIndex((g) => y.name.startsWith(g)))[0] ?? null;
  // Places to keep away from for a while: where it died under ground, where cave spiders are.
  const dangerous = (at) => (memory.danger ?? []).some((zone) => zone.until > Date.now()
    && Math.hypot(at.x - zone.x, at.y - zone.y, at.z - zone.z) < zone.r);
  const nameAt = (at) => bot.blockAt(at)?.name ?? null;
  const solid = (at) => bot.blockAt(at)?.boundingBox === 'block';
  const matcher = (name) => name === 'log' ? (b) => b.name.endsWith('_log') : (b) => b.name === name;
  const nearest = (name, distance = 32) => bot.findBlock({ matching: matcher(name), maxDistance: distance });
  // A spider in daylight leaves the player alone. Turn 7: unarmed in the morning, the player
  // spent minutes "backing away" from one that was only walking about, and nothing else ran.
  const calm = (e) => e.name === 'spider' && !night();
  const nearestHostile = (distance = 16) => bot.nearestEntity((e) =>
    isHostile(e) && !calm(e) && e.position.distanceTo(bot.entity.position) <= distance);
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

  // strict: for a walk whose whole point is to get somewhere (a climb, a leg of a journey).
  // The pathfinder ends a walk it has no path for at all in the same way as one it has
  // finished: quietly. At 07:49 on 2026-10-04 a climb "arrived" 524 times in 5 minutes without
  // moving. A strict walk that ended at once, went nowhere and is not at its goal is no path.
  async function walk(goal, ms = 45000, what = 'walking', strict = false) {
    check();
    await offTheBed();
    const from = bot.entity.position.clone();
    const started = Date.now();
    // On foot first. The pathfinder digs and builds its way as readily as it walks, and under
    // the open sky that is how the ground round the base came to be holes, steps of earth and
    // towers (94 blocks put down in one morning's felling, 2026-10-04). So above ground it is
    // asked first whether there is a way with nothing dug and nothing placed, for up to a
    // third of a second, and takes that way if there is one. (Mindcraft's goToGoal does the same.)
    const moves = bot.pathfinder.movements;
    const was = { canDig: moves.canDig, towers: moves.allow1by1towers, scaffold: moves.scafoldingBlocks };
    const harsh = () => { moves.canDig = was.canDig; moves.allow1by1towers = was.towers; moves.scafoldingBlocks = was.scaffold; };
    let onFoot = false;
    if (moves.canDig && exposed() && !memory.pass?.brave) {
      moves.canDig = false;
      moves.allow1by1towers = false;
      moves.scafoldingBlocks = [];
      try {
        const asked = Date.now();
        let found = null;
        for (const step of bot.pathfinder.getPathFromTo(moves, bot.entity.position, goal, { timeout: 350, tickTimeout: 50 })) {
          found = step.result;
          if (found.status !== 'partial' || Date.now() - asked > 350) break;
        }
        onFoot = found?.status === 'success' && found.path.length <= 220;
      } catch {
        onFoot = false;
      }
      if (!onFoot) harsh();
    }
    try {
      await within(bot.pathfinder.goto(goal), ms, what);
    } catch (error) {
      bot.pathfinder.setGoal(null);
      // The way on foot was lost on the way (the world changed, or the goal moved): once more,
      // with digging and building allowed, in what is left of the time.
      const stopped = signal?.aborted || /took too long|stopped|out of time/.test(error?.message ?? '');
      const left = ms - (Date.now() - started);
      if (!onFoot || stopped || left < 3000) { harsh(); throw error; }
      harsh();
      onFoot = false;
      try {
        await within(bot.pathfinder.goto(goal), left, what);
      } catch (again) {
        bot.pathfinder.setGoal(null);
        throw again;
      }
    } finally {
      if (onFoot) harsh();
    }
    if (strict && Date.now() - started < 1500 && bot.entity.position.distanceTo(from) < 0.5
      && typeof goal.isEnd === 'function' && !goal.isEnd(bot.entity.position.floored())) {
      throw new Error(`No path to the goal! (${what}: the pathfinder gave no way at all)`);
    }
  }

  // One look for the atlas (atlas.mjs): every block of the named kinds within 40 blocks, and
  // every creature of the named kinds in sight, as [{ name, x, y, z }]. Looks only.
  function prospect(blocks, creatures) {
    const ids = blocks.map((name) => bot.registry.blocksByName[name]?.id).filter((id) => id !== undefined);
    const out = [];
    for (const at of bot.findBlocks({ matching: ids, maxDistance: 40, count: 400 })) {
      const block = bot.blockAt(at);
      if (block) out.push({ name: block.name, x: at.x, y: at.y, z: at.z });
    }
    const wanted = new Set(creatures);
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || !wanted.has(e.name) || !e.position) continue;
      out.push({ name: e.name, x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) });
    }
    return out;
  }

  // Through a door or a gate on foot: walk to `from`, open it, go straight to `to` on the other
  // side, and shut it behind. All three are places to stand (Vec3 of the feet). The pathfinder
  // is not asked to open anything: its own way of doing it ends the process (RESEARCH.md).
  // True when the player ends up standing at `to`.
  async function through(barrier, from, to) {
    const openable = () => /_door$|_fence_gate$/.test(nameAt(barrier) ?? '');
    const isOpen = () => String(bot.blockAt(barrier)?.getProperties?.().open) === 'true';
    const set = async (open) => {
      if (!openable() || isOpen() === open) return;
      await bot.lookAt(barrier.offset(0.5, 0.5, 0.5), true);
      await within(bot.activateBlock(bot.blockAt(barrier)), 4000, open ? 'opening it' : 'shutting it').catch(() => {});
      await sleep(300);
    };
    const there = (at, slack) => Math.abs(bot.entity.position.x - at.x - 0.5) < slack && Math.abs(bot.entity.position.z - at.z - 0.5) < slack;
    if (!there(from, 0.45)) await walk(new goals.GoalBlock(from.x, from.y, from.z), 40000, 'walking to the door');
    await settle();
    await set(true);
    await bot.lookAt(to.offset(0.5, 1.2, 0.5), true);
    bot.setControlState('forward', true);
    for (let i = 0; i < 30 && !there(to, 0.35); i++) await sleep(100);
    bot.clearControlStates();
    await sleep(150);
    const feet = bot.entity.position.floored();
    if (!(feet.x === barrier.x && feet.z === barrier.z)) await set(false);
    return there(to, 0.6);
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
  const wetAt = (at) => /water|bubble_column|kelp|seagrass/.test(nameAt(at) ?? '');
  // Stone on a river bed is still stone to a search through the rock: death 12 was 8 stone
  // for a furnace, dug under water. Nothing with water on any side, or two blocks over it, is gone for.
  const nextToWater = (at) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0, 2, 0]]
    .some(([dx, dy, dz]) => wetAt(at.offset(dx, dy, dz)));

  // The nearest place to be with the head in air: on something solid, or afloat at the surface.
  // The first version of the way out remembered "the last place with a full breath", and a
  // place one step into a river has a full breath too: it walked there and drowned (death 12).
  function airNear(radius = 10) {
    const feet = bot.entity.position.floored();
    let best = null;
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -3; dy <= 8; dy++) {
      const at = feet.offset(dx, dy, dz);
      if (solid(at) || solid(at.offset(0, 1, 0)) || wetAt(at.offset(0, 1, 0)) || /lava/.test(nameAt(at) ?? '')) continue;
      const below = at.offset(0, -1, 0);
      if (!solid(below) && !wetAt(at)) continue;
      const cost = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 0.7;
      if (!best || cost < best.cost) best = { at, cost };
    }
    return best?.at ?? null;
  }

  // How far it is down to real ground from where the player stands (leaves and logs are not ground).
  function heightAboveGround() {
    const feet = bot.entity.position.floored();
    for (let down = 1; down < 40; down++) {
      const block = bot.blockAt(feet.offset(0, -down, 0));
      if (block && block.boundingBox === 'block' && !/_leaves$|_log$/.test(block.name)) return down - 1;
    }
    return 40;
  }

  // Down out of a treetop by the trunk: stand on the top log and dig the trunk away from under
  // the feet, one log at a time. The world's spawn point is a treetop 11 blocks up; the
  // pathfinder spent 2 minutes there after death 12 and moved 2 blocks.
  async function downFromTree() {
    const from = bot.entity.position;
    const trunk = bot.findBlocks({ matching: (b) => b.name.endsWith('_log'), maxDistance: 8, count: 256 })
      .filter((at) => at.y < from.y && trunkHeight(at) !== null && Math.hypot(at.x + 0.5 - from.x, at.z + 0.5 - from.z) < 6)
      .sort((a, b) => b.y - a.y || a.distanceTo(from) - b.distanceTo(from))[0];
    if (!trunk) {
      // No trunk under these leaves (the canopy of a big tree, its trunk somewhere else): let the
      // pathfinder drop further than it normally may, when the fall is one the player can take.
      // A fall costs its height less 3; from here that was 7 of 20 when it happened by accident.
      const height = heightAboveGround();
      if (height > 14 || bot.health - Math.max(0, height - 3) < 6) return { ok: false, error: `no trunk to go down by, and ${height} blocks is too far to drop at ${Math.round(bot.health)} health` };
      const usual = movements.maxDropDown;
      movements.maxDropDown = height + 1;
      try {
        await walk(new goals.GoalY(Math.floor(from.y) - height), 25000, 'dropping out of the tree');
      } catch (error) {
        check();
      } finally {
        movements.maxDropDown = usual;
      }
      await settle();
      const left = heightAboveGround();
      return left <= 1 ? { ok: true, logs: 0 } : { ok: false, error: `no trunk to go down by; tried the drop and am still ${left} blocks up` };
    }
    await walk(new goals.GoalNear(trunk.x, trunk.y + 1, trunk.z, 0), 20000, 'getting onto the trunk').catch(() => {});
    let logs = 0;
    for (let i = 0; i < 40; i++) {
      check();
      const feet = bot.entity.position.floored();
      const under = bot.blockAt(feet.offset(0, -1, 0));
      if (!under || !/_leaves$|_log$/.test(under.name)) break;
      if (under.name.endsWith('_leaves') && !solid(feet.offset(0, -2, 0)) && !solid(feet.offset(0, -3, 0)) && !solid(feet.offset(0, -4, 0))) {
        return { ok: false, error: `a drop of more than 3 under the leaves at ${feet.x} ${feet.y} ${feet.z}` };
      }
      const tool = bot.pathfinder.bestHarvestTool(under);
      if (tool) await bot.equip(tool, 'hand');
      await within(bot.dig(under, true), 15000, 'digging down the trunk');
      if (under.name.endsWith('_log')) logs += 1;
      await sleep(350);
      await settle();
    }
    await pickUp(4, 3);
    const left = heightAboveGround();
    return left <= 1 ? { ok: true, logs } : { ok: false, error: `still ${left} blocks up` };
  }

  // The nearest block of a kind worth going for: a trunk a person can reach from the ground,
  // nothing touching lava, nothing within 12 blocks of another player (the world is shared).
  // Stone and ore are found through the rock, as the benchmark's player finds them, and the
  // pathfinder digs its way there.
  function reachable(name) {
    const from = bot.entity.position;
    const isLog = name === 'log' || name.endsWith('_log');
    const found = bot.findBlocks({ matching: matcher(name), maxDistance: 48, count: 1024 })
      .filter((at) => !crowded(at) && !inBase(at) && !dangerous(at))
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
    for (const at of found) {
      if (isLog) { const height = trunkHeight(at); if (height === null || height > 3) continue; }
      else if (nextToLava(at) || nextToWater(at)) continue;
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
      // Not what was thrown away on purpose.
      const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < radius
        && !JUNK.test(e.getDroppedItem?.()?.name ?? ''));
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
      // Turn 5: "destination full", twice. The furnace still held coal from the smelt before
      // and this one brought planks. What is already in a furnace is looked at first: the
      // output is taken, input of another kind is taken, and fuel that is there is used.
      if (furnace.outputItem()) await furnace.takeOutput();
      const oldInput = furnace.inputItem();
      if (oldInput && oldInput.name !== input) await furnace.takeInput();
      const oldFuel = furnace.fuelItem();
      const oldFuelEnough = oldFuel && fuelNeeded(oldFuel.name, count) !== null && oldFuel.count >= fuelNeeded(oldFuel.name, count);
      if (oldFuel && oldFuel.name !== fuel && !oldFuelEnough) await furnace.takeFuel();
      if (!oldFuelEnough) {
        const there = oldFuel?.name === fuel ? oldFuel.count : 0;
        if (there < fuelCount) await furnace.putFuel(bot.registry.itemsByName[fuel].id, null, fuelCount - there);
      }
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

  // The best thing to eat that is carried, or null. Nothing that poisons.
  function bestFood() {
    const foods = bot.registry.foodsByName ?? {};
    return bot.inventory.items()
      .filter((i) => foods[i.name] && !/rotten_flesh|spider_eye|poisonous|pufferfish|^chicken$/.test(i.name))
      .sort((a, b) => (foods[b.name].foodPoints ?? 0) - (foods[a.name].foodPoints ?? 0))[0] ?? null;
  }
  const hasFood = () => !!bestFood();

  async function eat() {
    const food = bestFood();
    if (!food) return { ok: false, error: 'no food carried' };
    await bot.equip(food, 'hand');
    await within(bot.consume(), 6000, 'eating');
    return { ok: true, ate: food.name };
  }

  // Armour and shield carried in the pack that should be on: a place that is empty, or one
  // holding something worse. Turn 12: a full set of diamond armour sat in the pack while the
  // iron set was worn, because only empty places were filled.
  function unworn() {
    const grade = (name) => { const at = GRADES.findIndex((g) => name.startsWith(g)); return at < 0 ? GRADES.length : at; };
    const best = {};
    for (const item of bot.inventory.items()) {
      const kind = /_(helmet|chestplate|leggings|boots)$/.exec(item.name)?.[1];
      if (!kind) continue;
      const worn = bot.inventory.slots[bot.getEquipmentDestSlot(ARMOUR[kind])];
      if (worn && grade(worn.name) <= grade(item.name)) continue;
      if (!best[kind] || grade(item.name) < grade(best[kind].name)) best[kind] = item;
    }
    const shield = !bot.inventory.slots[45] && bot.inventory.items().find((item) => item.name === 'shield');
    return [...Object.values(best), ...(shield ? [shield] : [])];
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
    const weapon = bestOf('_sword') ?? bestOf('_axe');
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

  // What is worth a place in the chest, and what is not. Turn 15: the chest was filled with
  // stone of six kinds by the first version of this, and then 54 diamonds could not be put in:
  // "nothing to put in", ten times in five seconds, with the diamonds still on the player.

  // Where junk that was just thrown away has come to rest, remembered for the 5 minutes it lies there.
  function markJunk() {
    const now = Date.now();
    const heaps = Object.values(bot.entities)
      .filter((e) => e.name === 'item' && e.position.distanceTo(bot.entity.position) < 10 && JUNK.test(e.getDroppedItem?.()?.name ?? ''))
      .map((e) => ({ ...round(e.position), until: now + 300000 }));
    memory.junk = [...(memory.junk ?? []).filter((heap) => heap.until > now), ...heaps].slice(-40);
    return heaps.length;
  }

  // What the player carries that belongs in the chest: [name, count]. Not junk, not what a
  // trip needs, and one of the best pickaxe, the best sword and an iron pickaxe stay in hand.
  // A hoe stays too: at 08:59 on 2026-10-04 the crops goal made a hoe three times and this put
  // each one in the chest a second later.
  function spares() {
    const keepOne = new Set([bestOf('_pickaxe')?.name, bestOf('_sword')?.name, bestOf('_axe')?.name, bestOf('_hoe')?.name, 'iron_pickaxe'].filter(Boolean));
    const kept = {};
    const out = {};
    let diamonds = diamondsWanted(have());
    for (const item of bot.inventory.items()) {
      if (JUNK.test(item.name) || KEPT_ON_THE_PLAYER.test(item.name)) continue;
      let count = item.count;
      if (item.name === 'diamond') { const keep = Math.min(count, diamonds); count -= keep; diamonds -= keep; }
      if (keepOne.has(item.name) && !kept[item.name]) { kept[item.name] = true; count -= 1; }
      if (count > 0) out[item.name] = (out[item.name] ?? 0) + count;
    }
    return Object.entries(out);
  }

  // Put the spares into the chest in the base, so that a death does not take them. Junk that
  // an earlier version put in there is taken out first, as much as the pack has room for; it
  // leaves with the player and is thrown away outside. Says so when the chest is full.
  async function stash(chestAt) {
    const block = bot.blockAt(new Vec3(chestAt.x, chestAt.y, chestAt.z));
    if (block?.name !== 'chest') return { ok: false, error: 'no chest there' };
    await walk(new goals.GoalNear(chestAt.x, chestAt.y, chestAt.z, 2), 30000, 'walking to the chest');
    const chest = await within(bot.openContainer(block), 8000, 'opening the chest');
    const put = {};
    const taken = {};
    let full = null;
    try {
      for (const item of chest.containerItems()) {
        check();
        if (!JUNK.test(item.name) || bot.inventory.emptySlotCount() <= 3) continue;
        try {
          await within(chest.withdraw(item.type, null, item.count), 5000, `taking ${item.name} out of the chest`);
          taken[item.name] = (taken[item.name] ?? 0) + item.count;
        } catch (error) { /* the pack has no room for it: it stays for the next visit */ }
      }
      for (const [name, count] of spares()) {
        check();
        try {
          await within(chest.deposit(bot.registry.itemsByName[name].id, null, count), 5000, `putting ${name} in the chest`);
          put[name] = count;
        } catch (error) {
          full = `${name} would not go in: ${error.message}`;
          break;
        }
      }
      // What the chest holds now is remembered, so that the brain knows what a death can be made good from.
      memory.chest = {};
      for (const item of chest.containerItems()) memory.chest[item.name] = (memory.chest[item.name] ?? 0) + item.count;
    } finally {
      chest.close();
    }
    return full ? { ok: false, error: full, put, taken } : { ok: true, put, taken };
  }

  // Take from the chest what kitFrom() says, and remember what is left in it.
  async function kit(chestAt) {
    const block = bot.blockAt(new Vec3(chestAt.x, chestAt.y, chestAt.z));
    if (block?.name !== 'chest') return { ok: false, error: 'no chest there' };
    await walk(new goals.GoalNear(chestAt.x, chestAt.y, chestAt.z, 2), 30000, 'walking to the chest');
    const chest = await within(bot.openContainer(block), 8000, 'opening the chest');
    const taken = {};
    try {
      const there = {};
      for (const item of chest.containerItems()) there[item.name] = (there[item.name] ?? 0) + item.count;
      for (const [name, count] of kitFrom(have(), there)) {
        check();
        try {
          await within(chest.withdraw(bot.registry.itemsByName[name].id, null, count), 5000, `taking ${name} out of the chest`);
          taken[name] = count;
        } catch (error) { /* no room, or gone: the next visit tries again */ }
      }
      memory.chest = {};
      for (const item of chest.containerItems()) memory.chest[item.name] = (memory.chest[item.name] ?? 0) + item.count;
    } finally {
      chest.close();
    }
    return { ok: true, taken, left: memory.chest };
  }

  // Feed two animals that stand near each other, so that they breed. The proof that it worked
  // is the game's advancement (The Parrots and the Bats), not this function's word.
  async function breed(name, food) {
    const held = () => find(new RegExp(`^${food}$`));
    if ((carried()[food] ?? 0) < 2) return { ok: false, error: `need 2 ${food}, have ${carried()[food] ?? 0}` };
    const from = bot.entity.position;
    const all = Object.values(bot.entities).filter((e) => e.name === name && e.position.distanceTo(from) < 48);
    let pair = null;
    for (const a of all) for (const b of all) {
      if (a.id < b.id && a.position.distanceTo(b.position) < 8 && (!pair || a.position.distanceTo(from) < pair[0].position.distanceTo(from))) pair = [a, b];
    }
    if (!pair) return { ok: false, error: `no two ${name}s within 8 blocks of each other (${all.length} in sight)` };
    let fed = 0;
    for (const animal of pair) {
      check();
      await walk(new goals.GoalFollow(animal, 2), 25000, `walking to a ${name}`).catch(() => {});
      if (!bot.entities[animal.id] || animal.position.distanceTo(bot.entity.position) > 4.5 || !held()) continue;
      await bot.equip(held(), 'hand');
      await bot.lookAt(animal.position.offset(0, (animal.height ?? 0.7) * 0.5, 0), true);
      await bot.activateEntity(animal);
      fed += 1;
      await sleep(600);
    }
    await sleep(6000);
    return fed === 2 ? { ok: true, fed } : { ok: false, error: `fed ${fed} of 2 ${name}s` };
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

  // A wheat plot by water (fogsift, 2026-10-04: "prepare to get some crops going"). Earth that
  // is level with open water and within 4 blocks of it stays wet when tilled, and wheat grows
  // fastest on wet ground. near: a place to make the plot by, or nothing for the best bank
  // within 48 blocks. Every seed carried is planted; what is ripe is cut and planted again.
  async function farm(near = null) {
    if (!find(/_hoe$/)) return { ok: false, error: 'no hoe' };
    const keepClear = others();
    const earthAt = (at) => /^(grass_block|dirt|farmland)$/.test(nameAt(at) ?? '') && /^(air|short_grass|wheat)$/.test(nameAt(at.offset(0, 1, 0)) ?? '');
    let water = memory.farm?.water ? new Vec3(memory.farm.water.x, memory.farm.water.y, memory.farm.water.z) : null;
    // A plot too far off to be seen is walked to, not given up: the first plot was 95 blocks
    // from home, read as "no water there" from the base, and a second plot was begun.
    if (water && nameAt(water) === null) {
      await walk(new goals.GoalNear(water.x, water.y + 1, water.z, 6), 90000, 'walking to the plot').catch(() => check());
    }
    if (water && nameAt(water) !== 'water') water = null;
    if (!water) {
      // With no place asked for, the bank nearest home that is good enough: the first plot was
      // made wherever the player stood with seeds in its hand, 95 blocks from its base.
      const reach = near ? 16 : 64;
      const home = memory.home ? new Vec3(memory.home.x, memory.home.y, memory.home.z) : bot.entity.position;
      const open = bot.findBlocks({ point: near ? new Vec3(near.x, near.y, near.z) : home, matching: bot.registry.blocksByName.water.id, maxDistance: reach, count: 600 })
        .filter((at) => nameAt(at.offset(0, 1, 0)) === 'air' && !keepClear.some((other) => other.distanceTo(at) < 6) && !inBase(at));
      let best = null;
      for (const at of open.filter((_, i) => i % 3 === 0).slice(0, 80)) {
        let banks = 0;
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (earthAt(at.offset(dx, 0, dz))) banks += 1;
        if (!best || banks > best.banks) best = { at, banks };
      }
      if (!best || best.banks < 4) return { ok: false, error: `no open water with earth level beside it within ${reach} blocks${best ? ` (the best had ${best.banks} blocks of bank)` : ''}` };
      water = best.at;
    }
    const plots = [];
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const at = water.offset(dx, 0, dz);
      if (earthAt(at) && !keepClear.some((other) => other.distanceTo(at) < 4)) plots.push(at);
    }
    plots.sort((a, b) => a.distanceTo(water) - b.distanceTo(water));
    let tilled = 0, planted = 0, cut = 0, growing = 0, lastError = null;
    for (const at of plots) {
      check();
      const above = at.offset(0, 1, 0);
      const crop = bot.blockAt(above);
      const ripe = crop?.name === 'wheat' && Number(crop.getProperties().age) === 7;
      if (crop?.name === 'wheat' && !ripe) { growing += 1; continue; }
      if (!ripe && !find(/^wheat_seeds$/)) continue;
      try {
        await walk(new goals.GoalNear(at.x, at.y + 1, at.z, 2), 20000, 'walking to the plot');
        if (ripe || nameAt(above) === 'short_grass') {
          await within(bot.dig(bot.blockAt(above), true), 4000, ripe ? 'cutting the wheat' : 'clearing the grass');
          await sleep(400);
          if (ripe) { cut += 1; await walk(new goals.GoalNear(at.x, at.y + 1, at.z, 0), 4000, 'picking up the wheat').catch(() => {}); }
        }
        if (nameAt(at) !== 'farmland') {
          await bot.equip(find(/_hoe$/), 'hand');
          await bot.lookAt(at.offset(0.5, 1, 0.5), true);
          await within(bot.activateBlock(bot.blockAt(at)), 4000, 'tilling');
          await sleep(400);
          if (nameAt(at) !== 'farmland') { lastError = `tilled and the block is still ${nameAt(at)}`; continue; }
          tilled += 1;
        }
        const seeds = find(/^wheat_seeds$/);
        if (!seeds) continue;
        await bot.equip(seeds, 'hand');
        await within(bot.placeBlock(bot.blockAt(at), new Vec3(0, 1, 0)), 4000, 'planting').catch(() => {});
        await sleep(300);
        if (nameAt(above) === 'wheat') planted += 1;
      } catch (error) {
        check();
        lastError = error.message;
      }
    }
    memory.farm = { water: { x: water.x, y: water.y, z: water.z }, planted: (memory.farm?.planted ?? 0) + planted, growing: growing + planted, at: Date.now() };
    const at = memory.farm.water;
    return tilled + planted + cut > 0 ? { ok: true, water: at, plots: plots.length, tilled, planted, cut, growing: growing + planted }
      : { ok: false, error: lastError ?? `nothing to do at the plot by ${at.x} ${at.y} ${at.z}: ${plots.length} places, ${growing} growing, ${carried().wheat_seeds ?? 0} seeds` };
  }

  // Still water or lava that lies open to the air, with a block of ground beside it to stand
  // on: { at, bank }, the nearest, or null. For lava the ground must have no lava against it
  // but the block being filled from, and none over it.
  function liquidNear(liquid, reach = 32) {
    const id = bot.registry.blocksByName[liquid]?.id;
    if (id === undefined) return null;
    const from = bot.entity.position;
    const still = (at) => Number(bot.blockAt(at)?.getProperties?.().level ?? 1) === 0;
    const spots = bot.findBlocks({ matching: id, maxDistance: reach, count: 300 })
      .filter((at) => still(at) && nameAt(at.offset(0, 1, 0)) === 'air' && !crowded(at) && !inBase(at))
      .sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
    for (const at of spots.slice(0, 40)) {
      const bank = SIDES.map(([dx, dz]) => at.offset(dx, 0, dz)).find((side) => {
        if (!solid(side) || solid(side.offset(0, 1, 0)) || solid(side.offset(0, 2, 0))) return false;
        if (liquid !== 'lava') return true;
        const others = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]
          .map(([dx, dy, dz]) => side.offset(dx, dy, dz)).filter((near) => !same(near, at) && /lava|fire/.test(nameAt(near) ?? ''));
        return others.length === 0;
      });
      if (bank) return { at, bank };
    }
    return null;
  }

  // Fill the empty bucket from such a place, standing on the ground beside it.
  async function fillBucket(liquid) {
    if (!find(/^bucket$/)) return { ok: false, error: 'no empty bucket' };
    const spot = liquidNear(liquid);
    if (!spot) return { ok: false, error: `no still ${liquid} lying open with ground beside it within 32 blocks` };
    const { at, bank } = spot;
    await walk(new goals.GoalBlock(bank.x, bank.y + 1, bank.z), 90000, `walking to the ${liquid}`);
    if (bot.entity.position.distanceTo(at.offset(0.5, 1, 0.5)) > 4.5) return { ok: false, error: `could not get beside the ${liquid} at ${at.x} ${at.y} ${at.z}` };
    await bot.equip(find(/^bucket$/), 'hand');
    await bot.lookAt(at.offset(0.5, 0.95, 0.5), true);
    await sleep(250);
    bot.activateItem();
    await sleep(700);
    bot.deactivateItem();
    await sleep(300);
    return (carried()[`${liquid}_bucket`] ?? 0) > 0 ? { ok: true, at: { x: at.x, y: at.y, z: at.z } }
      : { ok: false, error: `used the bucket on the ${liquid} at ${at.x} ${at.y} ${at.z} and it is still empty` };
  }

  // Four blocks closed around and one overhead.
  function enclosed() {
    const feet = bot.entity.position.floored();
    return solid(feet.offset(0, 2, 0)) && SIDES.every(([dx, dz]) => solid(feet.offset(dx, 0, dz)) && solid(feet.offset(dx, 1, dz)));
  }

  // Under a roof with walls on at least three sides: a dead end under ground. Nothing can
  // shoot into it and only one thing at a time can walk into it.
  function snug() {
    const feet = bot.entity.position.floored();
    if (!solid(feet.offset(0, 2, 0))) return false;
    return SIDES.filter(([dx, dz]) => solid(feet.offset(dx, 0, dz)) && solid(feet.offset(dx, 1, dz))).length >= 3;
  }

  // With nothing to close a hole with (the usual state after a death): two blocks into the
  // side of the hole instead. Turn 7: empty-handed after death 12 it stood in a half-dug pit
  // for five minutes of night and was shot from 18 health to 10.
  async function burrow() {
    const feet = bot.entity.position.floored();
    for (const [dx, dz] of SIDES) {
      const cells = [feet.offset(dx, 1, dz), feet.offset(dx, 0, dz), feet.offset(2 * dx, 1, dz * 2), feet.offset(2 * dx, 0, 2 * dz)];
      if (!cells.every((cell) => solid(cell) && !nextToLava(cell) && !nextToWater(cell))) continue;
      if (!solid(feet.offset(2 * dx, 2, 2 * dz)) || !solid(feet.offset(2 * dx, -1, 2 * dz))) continue;
      for (const cell of cells) {
        check();
        if (nearestHostile(3)) return { ok: false, error: 'a monster came within 3 blocks while burrowing' };
        const block = bot.blockAt(cell);
        const tool = bot.pathfinder.bestHarvestTool(block);
        if (tool) await bot.equip(tool, 'hand');
        await within(bot.dig(block, true), 30000, 'burrowing sideways');
      }
      await walk(new goals.GoalBlock(feet.x + 2 * dx, feet.y, feet.z + 2 * dz), 6000, 'stepping into the burrow').catch(() => {});
      return snug() ? { ok: true, note: 'two blocks into the side of the hole' } : { ok: false, error: 'the burrow is not closed in' };
    }
    return { ok: false, error: 'no side of the hole to burrow into' };
  }

  // A place to stand with three blocks of real ground under it, away from monsters and
  // other players. The world's spawn point is in a treetop, where a hole cannot be dug.
  function groundSpot() {
    const feet = bot.entity.position.floored();
    const foes = Object.values(bot.entities).filter(isHostile).map((e) => e.position);
    const keepClear = others();
    // Not in or beside anything built. On 2026-10-04 the shelter was dug twice in the farm the
    // player was building, 3 blocks down through the path between the plots.
    const built = bot.findBlocks({ matching: (b) => /^(farmland|wheat|carrots|potatoes|beetroots|.*_fence|.*_fence_gate|.*_planks|.*_bed|chest|.*_door|ladder)$/.test(b.name), maxDistance: 18, count: 120 });
    let best = null;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = -12; dy <= 2; dy++) {
      const at = feet.offset(dx, dy, dz);
      if (solid(at) || solid(at.offset(0, 1, 0))) continue;
      if (built.some((b) => Math.abs(b.x - at.x) <= 4 && Math.abs(b.z - at.z) <= 4 && Math.abs(b.y - at.y) <= 6)) continue;
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
    check();   // stopped for something more urgent while walking there
    await settle();
    const start = bot.entity.position.floored();
    for (let depth = 0; depth < 3; depth++) {
      const under = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0));
      if (under?.boundingBox !== 'block' || nextToLava(under.position)) break;
      check();
      if (nearestHostile(4)) return { ok: false, error: 'a monster came within 4 blocks while digging in' };
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
      if (!filler) return burrow();
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

  // The cells of the base's room that are shut off from its doorway, as [dx, dz] from the
  // middle. A cell can be walked when nothing solid is at foot or head height. extra: a cell
  // to count as taken, to ask "what if something were put here?" before it is.
  function roomShutIn(c, extra = null) {
    const walkable = new Set();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (extra && extra[0] === dx && extra[1] === dz) continue;
      if (!solid(c.offset(dx, 0, dz)) && !solid(c.offset(dx, 1, dz))) walkable.add(`${dx},${dz}`);
    }
    walkable.add('2,0');   // the doorway, which is opened from inside when it is closed
    return shutIn(walkable, [2, 0]);
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

  // Out of bed. The library's own way sends this game version a number where it wants a name
  // (26.1 calls the action "stop_sleeping"; the library sends 2, which is "stop sprinting"
  // here), so for a day and a half the player could only wait for the morning.
  async function getUp() {
    if (!bot.isSleeping) return true;
    try {
      bot._client.write('entity_action', { entityId: bot.entity.id, actionId: 'stop_sleeping', jumpBoost: 0 });
    } catch (error) {
      await bot.wake().catch(() => {});
    }
    for (let waited = 0; waited < 20 && bot.isSleeping; waited++) await sleep(150);
    return !bot.isSleeping;
  }

  // Get into bed, the player's own when it remembers one and it is still there. The night
  // ends when enough players are asleep, and how many that takes is the world's rule, not the
  // player's. So it waits; if the night goes on, it asks the others in chat, three times; and
  // if they still are not in bed it says so and gets up (CT, 2026-10-04: "if they don't after
  // 3 chat messages, you should say 'fine screw it I'm going mining then'").
  //   beforeBed: something to do once it stands by the bed.   say: how to speak in chat.
  // Get into the bed, and stay in it until morning or until it is right to give up.
  // stay: it was asked to sleep, by a person or by the game's count of sleepers. Then it does
  // not get up by itself. Not asked, it tells the others to sleep three times and then leaves
  // (CT, 2026-10-04), unless one of them is in a bed by then: nobody is left waiting alone.
  // On 2026-10-04 fogsift lay in his bed while this player, called back to its own, said its
  // three lines and left again, twice (09:27:30 and 09:32:01).
  async function sleepInBed(beforeBed = null, say = null, { stay = false, seconds = 100 } = {}) {
    const stillNight = () => bot.time.timeOfDay >= 12541 && bot.time.timeOfDay <= 23458;
    let time = bot.time.timeOfDay;
    let at = null;
    if (!bot.isSleeping) {
      const own = memory.places?.bed && bot.blockAt(new Vec3(memory.places.bed.x, memory.places.bed.y, memory.places.bed.z));
      const bed = own?.name?.endsWith('_bed') ? own : bot.findBlock({ matching: (b) => b.name.endsWith('_bed'), maxDistance: 24 });
      if (!bed) return { ok: false, error: 'no bed within 24 blocks' };
      at = round(bed.position);
      await walk(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2), 60000, 'walking to the bed');
      if (beforeBed) await beforeBed();
      const deadline = Date.now() + 70000;
      while (bot.time.timeOfDay > 11000 && bot.time.timeOfDay < 12541 && Date.now() < deadline) { check(); await sleep(50); }
      // The bed will not take a player with something hostile within 8 blocks of it, walls or
      // no walls. It is tried again for 45 s: what can be fought is gone after, a creeper is
      // waited for. If it still will not, the reason names what stood near the bed.
      const tryUntil = Date.now() + 45000;
      const near = [];
      for (;;) {
        check();
        time = bot.time.timeOfDay;
        try {
          await within(bot.sleep(bot.blockAt(bed.position)), 8000, 'getting into bed');
          break;
        } catch (error) {
          check();
          const foe = bot.nearestEntity((e) => isHostile(e) && Math.abs(e.position.x - bed.position.x) <= 9 && Math.abs(e.position.z - bed.position.z) <= 9
            && e.position.y - bed.position.y <= 5 && bed.position.y - e.position.y <= 7);
          if (foe) near.push(`${foe.name} ${Math.round(foe.position.distanceTo(bed.position))} blocks off`);
          if (!/monsters/.test(error.message) || Date.now() > tryUntil) {
            return { ok: false, error: `${error.message} (time ${time}${near.length ? `; by the bed: ${[...new Set(near)].slice(0, 3).join(', ')}` : ''})` };
          }
          if (foe && foe.name !== 'creeper' && (bestOf('_sword') ?? bestOf('_axe'))) await hunt(foe.name).catch(() => check());
          else await sleep(4000);
          await walk(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2), 20000, 'back to the bed').catch(() => check());
        }
      }
    }
    const waitForMorning = async (wait) => {
      for (let waited = 0; waited < wait * 2 && bot.isSleeping && stillNight(); waited++) { check(); await sleep(500); }
      return !bot.isSleeping || !stillNight();
    };
    if (await waitForMorning(8)) return { ok: true, at, time, upAt: bot.time.timeOfDay, asked: 0 };
    const others = Object.keys(bot.players).filter((name) => name !== bot.username);
    if (!others.length || !say) {
      await waitForMorning(Math.max(40, seconds));
      return { ok: true, at, time, upAt: bot.time.timeOfDay, asked: 0 };
    }
    // How many are in a bed, as the game last said it ("2/3 players sleeping"), this player among them.
    const count = () => (memory.sleepers && Date.now() - memory.sleepers.at < 180000 ? memory.sleepers : null);
    const othersAsleep = () => Math.max(0, (count()?.asleep ?? 0) - (bot.isSleeping ? 1 : 0));
    const asks = [
      `${others.join(', ')}: could you get into a bed, please? I am in mine, and the night ends when we are all asleep.`,
      `Still in bed and still night. ${others.join(' and ')}, a bed each and it is morning.`,
      'Last time of asking: bed, please.',
    ];
    let asked = 0;
    for (;;) {
      const next = inBed({ stay, othersAsleep: othersAsleep(), asked });
      if (next === 'stay') break;
      if (next === 'leave') {
        say('Fine, screw it, I\'m going mining then.');
        const up = await getUp();
        return { ok: true, at, time, upAt: bot.time.timeOfDay, asked, gaveUp: true, up };
      }
      say(asks[asked]);
      asked += 1;
      if (await waitForMorning(20)) return { ok: true, at, time, upAt: bot.time.timeOfDay, asked };
    }
    // Staying: until morning, or until the time this step was given runs out.
    const told = count();
    say(told ? `In bed, and staying. ${told.asleep} of ${told.needed} asleep: whoever is still up, a bed please.`
      : `In bed, and staying until morning. ${others.join(' and ')}: a bed each and the night is over.`);
    const until = Date.now() + seconds * 1000;
    let lastSaid = Date.now();
    while (Date.now() < until) {
      if (await waitForMorning(5)) return { ok: true, at, time, upAt: bot.time.timeOfDay, asked, stayed: true };
      if (Date.now() - lastSaid > 90000) {
        const now = count();
        say(`Still in bed${now ? `: ${now.asleep} of ${now.needed} asleep` : ''}.`);
        lastSaid = Date.now();
      }
    }
    return { ok: true, at, time, upAt: bot.time.timeOfDay, asked, stayed: true, still: true };
  }

  return { liquidNear, fillBucket, kit, kitWants: () => kitFrom(have(), memory.chest ?? {}), markJunk, spares, roomShutIn, getUp, hasFood, stash, bestOf, dangerous, breed, snug, burrow, airNear, wetAt, heightAboveGround, downFromTree, inBase, crowded, placeAt, fill, digOut, sleepInBed, solid, night, exposed, canSee, enclosed, digIn, check, within, sleep, carried, have, find, nameAt, nearest,
    nearestHostile, settle, walk, reachable, digAt, pickUp, collectOne, tableNear, craft, placeNear, smelt, eat,
    unworn, wear, hunt, gatherSeeds, plantSeed, farm, goals, Vec3, round, isHostile, through, prospect };
}
