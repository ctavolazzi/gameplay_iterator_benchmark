// The brain: what to do next, asked whenever the player has nothing to do. It goes down a
// list of goals in order of how much they matter, and for the first one that is not done it
// asks the planner for the one next step. Whatever fails is remembered and left alone for a
// while, so a goal that cannot move does not hold up the ones below it.
//
// player.mjs loads this file again whenever it changes. think() returns a step
// { skill, args, why, goal, timeout } or null to wait; learn() sees every finished step.

const RAW = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', chicken: 'cooked_chicken' };
const FOOD = /^(cooked_\w+|bread|apple|baked_potato|carrot|beef|porkchop|mutton|melon_slice|sweet_berries)$/;
const ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];
const DIRECTIONS = ['north', 'east', 'south', 'west'];
const WORTH_GOING_BACK_FOR = /pickaxe|sword|iron|diamond|chestplate|leggings|helmet|boots|shield|bucket|furnace/;

// The wood to work in: what is carried most of, else the nearest tree.
function workingWood(have, seen) {
  const score = {};
  for (const [name, n] of Object.entries(have)) {
    const wood = /^(\w+?)_(planks|log)$/.exec(name);
    if (wood && !name.startsWith('stripped_')) score[wood[1]] = (score[wood[1]] ?? 0) + (wood[2] === 'log' ? 4 * n : n);
  }
  const carried = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
  return carried ?? seen.blocks.find((b) => b.name.endsWith('_log'))?.name.replace(/_log$/, '') ?? 'oak';
}

// The game's own recipes for an item, as plain lists of what they use.
function recipesOf(bot, name) {
  const item = bot.registry.itemsByName[name];
  if (!item) return [];
  return bot.recipesAll(item.id, null, true).map((recipe) => {
    const uses = {};
    for (const d of recipe.delta) {
      if (d.count < 0) { const used = bot.registry.items[d.id].name; uses[used] = (uses[used] ?? 0) - d.count; }
    }
    return { uses, makes: recipe.result.count, table: recipe.requiresTable };
  });
}

export async function think({ bot, api, observe, memory, earned, fresh }) {
  const { plan, hasTool, signature } = await fresh('planner.mjs');
  const now = Date.now();
  const seen = observe();
  const have = api.have();
  memory.blocked ??= {};
  memory.explored ??= {};
  for (const [sig, b] of Object.entries(memory.blocked)) if (now - b.until > 30 * 60000) delete memory.blocked[sig];

  // What a person asked for in chat comes first: wait where it is, or come to them.
  if (memory.order && now > memory.order.until) delete memory.order;
  if (memory.order?.kind === 'wait') {
    memory.thought = { at: new Date().toISOString(), goal: `waiting, as ${memory.order.player} asked`, step: null, stuck: {} };
    return null;
  }
  if (memory.order?.kind === 'come') {
    memory.thought = { at: new Date().toISOString(), goal: `coming to ${memory.order.player}`, step: 'come', stuck: {} };
    return { skill: 'come', args: { player: memory.order.player }, why: `${memory.order.player} asked in chat`, goal: 'asked', timeout: 60 };
  }

  // Hurt and out of danger: stay put and let the food do its work.
  if (bot.health <= 10 && !api.nearestHostile(8)) {
    memory.thought = { at: new Date().toISOString(), goal: `resting at ${Math.round(bot.health)} health`, step: null, stuck: {} };
    return null;
  }

  const sight = {};
  const world = {
    have,
    wood: workingWood(have, seen),
    recipes: (name) => recipesOf(bot, name),
    sees: (block) => (sight[block] ??= !!api.reachable(block)),
    creatures: seen.creatures.map((c) => c.name),
    near: { crafting_table: !!api.tableNear(24), furnace: !!api.nearest('furnace', 24) },
    night: api.night(),
    exposed: api.exposed(),
    y: bot.entity.position.y,
    surfaceY: memory.home?.y ?? 64,
    blocked: (step) => (memory.blocked[signature(step)]?.until ?? 0) > now,
  };
  const open = (step) => (world.blocked(step) ? null : step);
  const item = (name, count = 1) => () => ((have[name] ?? 0) >= count ? null : plan(name, count, world));
  const tool = (least) => () => (hasTool(have, least) ? null : plan(least, 1, world));
  const bedHad = Object.keys(have).some((name) => name.endsWith('_bed'));
  const foodCarried = Object.entries(have).filter(([name]) => FOOD.test(name)).reduce((sum, [, n]) => sum + n, 0);

  function recover() {
    const death = memory.lastDeath;
    if (!death) return null;
    const age = now - death.at;
    const worth = Object.keys(death.lost ?? {}).some((name) => WORTH_GOING_BACK_FOR.test(name));
    if (age > 270000 || !worth) { delete memory.lastDeath; return null; }
    if (world.night) return { stuck: 'what was dropped is on the surface at night' };
    return open({ skill: 'recover', args: { where: death.where }, timeout: 120,
      why: `what was dropped ${Math.round(age / 1000)} s ago` });
  }

  function food() {
    const raw = Object.keys(RAW).find((name) => have[name] > 0);
    if (raw && (world.near.furnace || have.furnace || have[raw] >= 3)) {
      return plan(RAW[raw], (have[RAW[raw]] ?? 0) + Math.min(have[raw], 8), world);
    }
    if (foodCarried >= 6 || world.night) return null;
    const animal = ANIMALS.find((name) => world.creatures.includes(name));
    if (animal && hasTool(have, 'wooden_sword')) return open({ skill: 'hunt', args: { animal }, why: `food: ${foodCarried} carried`, timeout: 60 });
    return null;
  }

  function seedy() {
    if (earned.includes('A Seedy Place')) return null;
    if (world.night) return { stuck: 'planting waits for morning' };
    if (!Object.keys(have).some((name) => name.endsWith('_hoe'))) return plan('wooden_hoe', 1, world);
    if (!have.wheat_seeds) return plan('wheat_seeds', 1, world);
    return open({ skill: 'plant_seed', args: {}, why: 'A Seedy Place', timeout: 60 }) ?? { stuck: 'planting keeps failing' };
  }

  // The race (CT, 2026-10-03): a base near the spawn point and a night in a bed there.
  const home = memory.home;
  const here = bot.entity.position;
  const fromHome = home ? Math.hypot(here.x - home.x, here.z - home.z) : 0;
  const time = bot.time.timeOfDay;
  const slept = earned.includes('Sweet Dreams');
  memory.slept = slept;

  function bed() {
    if (bedHad || memory.places?.bed || slept) return null;
    const step = plan('white_bed', 1, world);
    // Sheep were last seen at a known place: look there before wandering.
    const look = memory.lookFirst;
    if (step?.skill === 'explore' && look) {
      if (Math.hypot(here.x - look.x, here.z - look.z) > 16) {
        return { skill: 'goto', args: { x: look.x, z: look.z, range: 6 }, why: 'sheep were last seen there', timeout: 300 };
      }
      delete memory.lookFirst;
    }
    return step;
  }

  function base() {
    if (!home || slept) return null;
    const furnished = memory.base && memory.places?.crafting_table && memory.places?.furnace;
    const bedToPlace = bedHad && !memory.places?.bed;
    if (furnished && !bedToPlace) return null;
    if (!memory.base || !furnished) {
      if (!memory.places?.crafting_table || !memory.base) { const table = (have.crafting_table ?? 0) >= 1 ? null : plan('crafting_table', 1, world); if (table) return table; }
      if (!memory.places?.furnace || !memory.base) { const furnace = (have.furnace ?? 0) >= 1 ? null : plan('furnace', 1, world); if (furnace) return furnace; }
    }
    if (fromHome > 12 && world.night) return { stuck: 'the walk home waits for morning' };
    if (fromHome > 12) return { skill: 'goto', args: { x: home.x, z: home.z, range: 4 }, why: 'the base is dug at home', timeout: 300 };
    return open({ skill: 'build_base', args: {}, why: bedToPlace ? 'the bed goes in the base' : 'a room under the home site', timeout: 240 }) ?? { stuck: 'building the base keeps failing' };
  }

  // In order of how much each matters. A goal returns null when it is done.
  const goals = [
    ['wear', () => (api.unworn().length ? { skill: 'wear', args: {}, why: 'armour carried and not worn', timeout: 20 } : null)],
    ['recover', recover],
    ['pickaxe', tool('wooden_pickaxe')],
    // CT, 2026-10-03: a race with Codex's player to a base and a night in a bed near the
    // spawn point. The bed is three wool, so sheep come before everything but a pickaxe.
    ['home by dusk', () => (!slept && home && time > 10300 && time < 12700 && fromHome > 20
      ? { skill: 'goto', args: { x: home.x, z: home.z, range: 6 }, why: 'to be at the base before dark', timeout: 240 } : null)],
    ['sleep', () => (!slept && memory.places?.bed && time >= 12300 && time < 23300
      ? open({ skill: 'sleep', args: {}, why: 'Sweet Dreams, in my bed at my base', timeout: 100 }) : null)],
    ...(time < 7000 ? [['bed', bed], ['base', base]] : [['base', base], ['bed', bed]]),
    ['sword', tool('stone_sword')],
    ['stone pickaxe', tool('stone_pickaxe')],
    ['food', food],
    ['A Seedy Place', seedy],
    ['iron pickaxe', tool('iron_pickaxe')],
    ['Suit Up', item('iron_chestplate')],
    ['shield', item('shield')],
    ['iron sword', tool('iron_sword')],
    ['leggings', item('iron_leggings')],
    ['helmet', item('iron_helmet')],
    ['boots', item('iron_boots')],
    ['bucket', () => (have.bucket || have.water_bucket || have.lava_bucket ? null : plan('bucket', 1, world))],
    ['Diamonds!', () => (hasTool(have, 'diamond_pickaxe') ? null : plan((have.diamond ?? 0) >= 3 ? 'diamond_pickaxe' : 'diamond', 3, world))],
  ];

  const stuck = {};
  for (const [goal, next] of goals) {
    let step = next();
    if (!step) continue;
    if (step.skill === 'explore') step = heading(step, memory, world) ?? { stuck: 'every direction is blocked' };
    if (!step.stuck && step.skill !== 'explore' && repeating(step, memory, signature)) step = { stuck: `${signature(step)} repeated without getting anywhere` };
    if (step.stuck) { stuck[goal] = step.stuck; continue; }
    memory.thought = { at: new Date().toISOString(), goal, step: `${step.skill} ${JSON.stringify(step.args)}`, why: step.why, stuck };
    return { ...step, goal };
  }
  memory.thought = { at: new Date().toISOString(), goal: null, step: null, stuck };
  return null;
}

// Keep one heading while it works: four directions in turn would walk in a circle.
function heading(step, memory, world) {
  memory.heading ??= DIRECTIONS[Math.floor(Math.random() * 4)];
  for (let turn = 0; turn < 4; turn++) {
    const direction = DIRECTIONS[(DIRECTIONS.indexOf(memory.heading) + turn) % 4];
    const candidate = { ...step, args: { direction, blocks: 32 } };
    if (!world.blocked(candidate)) { memory.heading = direction; return candidate; }
  }
  return null;
}

// The same step chosen 10 times running is a loop, whatever each try reported.
function repeating(step, memory, signature) {
  const sig = signature(step);
  memory.streak = memory.streak?.sig === sig ? { sig, n: memory.streak.n + 1 } : { sig, n: 1 };
  if (memory.streak.n <= 10) return false;
  memory.blocked[sig] = { fails: 3, error: 'repeated without getting anywhere', until: Date.now() + 300000 };
  memory.streak = null;
  return true;
}

export async function learn({ row, memory, fresh }) {
  const { signature } = await fresh('planner.mjs');
  memory.blocked ??= {};
  memory.explored ??= {};
  const sig = signature(row);
  const interrupted = /^reflex:|night|died|asked to stop|disconnected|process stopping/.test(row.note ?? '');
  if (row.ok) delete memory.blocked[sig];
  else if (!interrupted) {
    const b = memory.blocked[sig] ??= { fails: 0 };
    b.fails += 1;
    b.error = row.note;
    b.until = Date.now() + Math.min(600, 20 * 2 ** (b.fails - 1)) * 1000;
  }
  if (row.skill === 'explore') {
    const direction = row.args?.direction;
    memory.explored[direction] = (memory.explored[direction] ?? 0) + 1;
    if (!row.ok && !interrupted) memory.heading = DIRECTIONS[(DIRECTIONS.indexOf(direction) + 1) % 4];
  }
  if (row.skill === 'recover') delete memory.lastDeath;
  if (row.skill === 'come') delete memory.order;
}
