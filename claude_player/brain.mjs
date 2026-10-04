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
  const { plan, hasTool, signature, leaves } = await fresh('planner.mjs');
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
  // Only when resting can heal: health comes back at 18 food or more (turn 3: it rested at 6
  // health with 17 food and nothing to eat, which would have been for ever).
  const canHeal = bot.food >= 18 || Object.keys(have).some((name) => /^(cooked_\w+|bread|apple|beef|porkchop|mutton|baked_potato|carrot)$/.test(name));
  if (bot.health <= (api.night() ? 10 : 5) && canHeal && !api.nearestHostile(8)) {
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
    tableKnown: (() => {
      const table = memory.places?.crafting_table;
      const from = bot.entity.position;
      return table && Math.hypot(from.x - table.x, from.z - table.z) < 40 ? table : null;
    })(),
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
    // The flock by the spawn point was three white sheep and a black one. The game's recipe
    // book (probed live) makes white wool from black wool and white dye, and white dye from a
    // lily of the valley or bone meal. So the third fleece need not be a fourth sheep.
    if ((have.white_wool ?? 0) < 3 && (have.white_wool ?? 0) + (have.black_wool ?? 0) >= 3) {
      const dye = (skill, args, why) => open({ skill, args, why, timeout: 90 });
      if (have.white_dye) return dye('craft', { item: 'white_wool', times: 1 }, 'black wool dyed white for the bed');
      if (have.lily_of_the_valley || have.bone_meal) return dye('craft', { item: 'white_dye', times: 1 }, 'white dye for the black wool');
      if (have.bone) return dye('craft', { item: 'bone_meal', times: 1 }, 'bone meal for white dye');
      const dusk = time < 14500 && fromHome < 60;
      if (dusk && world.sees('lily_of_the_valley')) memory.nightPass = now + 40000;
      const lily = (!world.night || dusk) && world.sees('lily_of_the_valley') && dye('collect', { block: 'lily_of_the_valley', count: 1 }, 'a lily makes white dye for the black wool');
      if (lily) return lily;
      // Lilies were found 60 blocks south of home (look_for, 01:38). Too far to see from most places: walk there.
      const known = memory.known?.lily_of_the_valley;
      if (known && !world.night && Math.hypot(here.x - known.x, here.z - known.z) > 24) {
        return { skill: 'goto', args: { x: known.x, z: known.z, range: 4 }, why: 'lilies grow there, and a lily makes the dye for the third fleece', timeout: 300 };
      }
    }
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
    // The first base is the room, the crafting table and the bed. The furnace follows the race.
    const tableIn = memory.base && memory.places?.crafting_table?.y === memory.base.y;
    const furnished = memory.base && tableIn;
    const bedToPlace = bedHad && !memory.places?.bed;
    if (furnished && !bedToPlace) return null;
    if (!memory.base || !furnished) {
      const table = (have.crafting_table ?? 0) >= 1 ? null : plan('crafting_table', 1, world);
      if (table) return table;
    }
    // With the bed in the pack the walk home is worth a short run in the dark.
    if (fromHome > 12 && world.night && bedToPlace && fromHome < 120) { memory.nightPass = now + 60000; memory.brave = now + 60000; }
    else if (fromHome > 12 && world.night) return { stuck: 'the walk home waits for morning' };
    if (fromHome > 12) return { skill: 'goto', args: { x: home.x, z: home.z, range: 4 }, why: 'the base is dug at home', timeout: 300 };
    return open({ skill: 'build_base', args: {}, why: bedToPlace ? 'the bed goes in the base' : 'a room under the home site', timeout: 240 }) ?? { stuck: 'building the base keeps failing' };
  }

  // CT's note: a crafting table or furnace that was put down can be broken and carried on.
  // Before a step that walks away, one of the player's own within 10 blocks is taken along.
  function tidy(step) {
    const target = step.skill === 'collect' ? api.reachable(step.args.block) : null;
    if (!leaves(step, target ? target.distanceTo(here) : null)) return null;
    const mine = (memory.own ?? []).find((o) => !api.inBase(o.at) && Math.hypot(here.x - o.at.x, here.y - o.at.y, here.z - o.at.z) < 10);
    if (!mine || (mine.name === 'furnace' && !hasTool(have, 'wooden_pickaxe'))) return null;
    return open({ skill: 'take_back', args: { item: mine.name, at: mine.at }, why: `my ${mine.name} comes along (CT's note)`, goal: 'tidy', timeout: 45 });
  }

  // In order of how much each matters. A goal returns null when it is done.
  const goals = [
    ['wear', () => (api.unworn().length ? { skill: 'wear', args: {}, why: 'armour carried and not worn', timeout: 20 } : null)],
    ['recover', recover],
    // The race comes before tools: a bed is wool and planks, and neither needs a pickaxe.
    ...(slept ? [] : [['bed', bed]]),
    ['pickaxe', tool('wooden_pickaxe')],
    // CT, 2026-10-03: a race with Codex's player to a base and a night in a bed near the
    // spawn point. The bed is three wool, so sheep come before everything but a pickaxe.
    ['home by dusk', () => {
      // Only with the bed: going home without one wins nothing.
      if (slept || !home || !(bedHad || memory.places?.bed) || time < 10300 || time > 14200 || fromHome < 20) return null;
      memory.nightPass = now + 45000;   // the last stretch may run a little past dark
      return { skill: 'goto', args: { x: home.x, z: home.z, range: 6 }, why: 'to be at the base before dark', timeout: 240 };
    }],
    ['into the base', () => (memory.base && api.night() && api.exposed() && fromHome < 20
      ? { skill: 'goto', args: { x: memory.base.x, y: memory.base.y, z: memory.base.z, range: 1 }, why: 'the night is spent in the base', timeout: 90 } : null)],
    ['sleep', () => (!slept && memory.places?.bed && time >= 12300 && time < 23300
      ? open({ skill: 'sleep', args: {}, why: 'Sweet Dreams, in my bed at my base', timeout: 100 }) : null)],
    // The room first: it is the part that has never been built, and wants time left to fix it.
    ['base', base],
    ['bed', bed],
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
    // Turn 6: this asked for 3 of whichever it was after, so 9 diamonds became 3 pickaxes.
    ['Diamonds!', () => (hasTool(have, 'diamond_pickaxe') ? null : (have.diamond ?? 0) >= 3 ? plan('diamond_pickaxe', 1, world) : plan('diamond', 3, world))],
    // Turn 6: with the list above done it stood still for the last 5 minutes 48 seconds of its
    // process. These keep it busy; a full set of diamond armour is the game's Cover Me with Diamonds.
    ['diamond sword', tool('diamond_sword')],
    ['diamond chestplate', item('diamond_chestplate')],
    ['diamond leggings', item('diamond_leggings')],
    ['diamond helmet', item('diamond_helmet')],
    ['diamond boots', item('diamond_boots')],
  ];

  const stuck = {};
  for (const [goal, next] of goals) {
    let step = next();
    if (!step) continue;
    if (step.skill === 'explore') step = heading(step, memory, world) ?? { stuck: 'every direction is blocked' };
    if (!step.stuck && step.skill !== 'explore' && repeating(step, memory, signature)) step = { stuck: `${signature(step)} repeated without getting anywhere` };
    if (step.stuck) { stuck[goal] = step.stuck; continue; }
    step = tidy(step) ?? step;
    memory.thought = { at: new Date().toISOString(), goal, step: `${step.skill} ${JSON.stringify(step.args)}`, why: step.why, stuck };
    return { goal, ...step };
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
  // A table that could not be taken back is let go of, so it is not tried for ever.
  if (row.skill === 'take_back' && !row.ok && row.args?.at) {
    const at = row.args.at;
    memory.own = (memory.own ?? []).filter((o) => !(o.at.x === at.x && o.at.y === at.y && o.at.z === at.z));
  }
}
