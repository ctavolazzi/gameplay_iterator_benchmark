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
  // The game's advancements and the curriculum over them. Without the list (no server jar to
  // read it from) the player plays on from its own list of goals.
  let curriculum = null, advancements = null;
  try { curriculum = await fresh('curriculum.mjs'); advancements = (await fresh('advancements.mjs')).load(); } catch { curriculum = null; }
  const now = Date.now();
  const seen = observe();
  const have = api.have();
  memory.blocked ??= {};
  memory.explored ??= {};
  for (const [sig, b] of Object.entries(memory.blocked)) if (now - b.until > 30 * 60000) delete memory.blocked[sig];

  // The atlas: what is in sight is written down every 15 s, and what is no longer where it was
  // is taken out, so that the planner can walk to a thing it passed an hour ago (atlas.mjs).
  let atlas = null;
  try {
    atlas = await fresh('atlas.mjs');
    if (now - (memory.atlasAt ?? 0) > 15000) {
      memory.atlasAt = now;
      memory.atlas ??= {};
      const at = bot.entity.position;
      const found = api.prospect(atlas.BLOCKS, atlas.CREATURES);
      atlas.note(memory.atlas, found, now, at, memory.home ?? at);
      atlas.forget(memory.atlas, found, now, at);
    }
  } catch { atlas = null; }

  // In a treetop (the world's spawn point is one): down by the trunk before anything else.
  if (/_leaves$/.test(api.nameAt(bot.entity.position.floored().offset(0, -1, 0)) ?? '') && api.heightAboveGround() > 4) {
    const down = { skill: 'down_from_tree', args: {}, why: `${api.heightAboveGround()} blocks up in a tree`, goal: 'down', timeout: 90 };
    if (!((memory.blocked?.['down_from_tree:']?.until ?? 0) > now)) {
      memory.thought = { at: new Date().toISOString(), goal: 'down', step: 'down_from_tree', why: down.why, stuck: {} };
      return down;
    }
  }

  // What a person asked for in chat comes first: wait where it is, or come to them.
  if (memory.order && now > memory.order.until) delete memory.order;
  if (memory.order?.kind === 'wait') {
    memory.thought = { at: new Date().toISOString(), goal: `waiting, as ${memory.order.player} asked`, step: null, stuck: {} };
    return null;
  }
  if (memory.order?.kind === 'bed') {
    // Asked in chat to sleep. To the bed and into it, from wherever it is; given up if the
    // bed is gone or it is no longer night.
    const bedAt = memory.places?.bed;
    const hour = bot.time.timeOfDay;
    // The order lasts the night: it is not dropped once the player is in its bed, or it would
    // get up for the next goal on the list while the one who asked lay waiting.
    if (!bedAt || hour < 12300 || hour > 23400) delete memory.order;
    else {
      const from = bot.entity.position;
      const far = Math.hypot(from.x - bedAt.x, from.y - bedAt.y, from.z - bedAt.z);
      const why = `${memory.order.player} asked in chat for everyone to sleep`;
      const step = far > 20 && from.y < bedAt.y - 16 ? { skill: 'surface', args: {}, why, goal: 'asked', timeout: 600, pass: { night: true } }
        : far > 20 ? { skill: 'goto', args: { x: bedAt.x, y: bedAt.y, z: bedAt.z, range: 3 }, why, goal: 'asked', timeout: 240, pass: { night: true } }
          : { skill: 'sleep', args: { stay: true }, why, goal: 'asked', timeout: Math.min(900, Math.round((23460 - hour) / 20) + 40), pass: { night: true } };
      // A step that has just failed waits its turn like any other. At 07:49 on 2026-10-04 the
      // climb to the bed was asked for 524 times in 5 minutes and failed in a quarter of a second each time.
      const held = (memory.blocked[signature(step)]?.until ?? 0) > now;
      memory.thought = { at: new Date().toISOString(), goal: 'asked to sleep', step: held ? 'waiting to try the way to bed again' : step.skill, why, stuck: {} };
      return held ? null : step;
    }
  }
  // In its bed with the night going on, and asked to be there or with someone else in a bed
  // too, nothing else is started: it stays. Told to resume, or alone in bed with nobody
  // waiting, it gets up for the next thing on its list (the first walk leaves the bed).
  const waiting = memory.sleepers && now - memory.sleepers.at < 180000 ? memory.sleepers.asleep - 1 : 0;
  if (bot.isSleeping && bot.time.timeOfDay >= 12541 && bot.time.timeOfDay < 23400 && (memory.order?.kind === 'bed' || waiting > 0)) {
    memory.thought = { at: new Date().toISOString(), goal: 'sleep', step: 'sleep', why: 'in bed, and the night is not over', stuck: {} };
    return { skill: 'sleep', args: { stay: true }, why: 'in bed, and the night is not over', goal: 'sleep', timeout: Math.min(900, Math.round((23460 - bot.time.timeOfDay) / 20) + 40), pass: { night: true } };
  }
  if (memory.order?.kind === 'follow') {
    // Asked to follow, in chat or from CT's menu in the game. The step is given again after a
    // fight has stopped it, until the time is up or someone says stop.
    const who = memory.order.player;
    const left = Math.round((memory.order.until - now) / 1000);
    memory.thought = { at: new Date().toISOString(), goal: `following ${who}`, step: 'follow', why: `${who} asked`, stuck: {} };
    return { skill: 'follow', args: { player: who, seconds: Math.min(880, left) }, why: `${who} asked`, goal: 'asked', timeout: Math.min(900, left + 15), pass: { night: true } };
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
    liquid: (kind) => (sight[`still ${kind}`] ??= !!api.liquidNear(kind)),
    creatures: seen.creatures.map((c) => c.name),
    near: { crafting_table: !!api.tableNear(24), furnace: !!api.nearest('furnace', 24) },
    tableKnown: (() => {
      const table = memory.places?.crafting_table;
      const from = bot.entity.position;
      // Near means near in height too: it set off for a table 63 blocks under its feet (turn 11).
      return table && Math.hypot(from.x - table.x, from.y - table.y, from.z - table.z) < 40 ? table : null;
    })(),
    night: api.night(),
    exposed: api.exposed(),
    y: bot.entity.position.y,
    surfaceY: memory.home?.y ?? 64,
    blocked: (step) => (memory.blocked[signature(step)]?.until ?? 0) > now,
    // Where any of these was last seen ('log' is any wood), for the planner to walk to.
    knows: (names) => (atlas ? atlas.nearest(memory.atlas, names.flatMap((name) => (name === 'log' ? atlas.BLOCKS.filter((b) => b.endsWith('_log')) : [name])), bot.entity.position, { now }) : null),
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
    if (age > 270000 || !worth || api.dangerous(death.where)) { delete memory.lastDeath; return null; }
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
    // Chickens are left alone while they are wanted for breeding: the hunt for food had been
    // eating the only two in sight before the breeding goal, lower down the list, was reached.
    const chicks = !earned.includes('The Parrots and the Bats') && (have.wheat_seeds ?? 0) >= 2;
    const animal = ANIMALS.find((name) => world.creatures.includes(name) && !(chicks && name === 'chicken'));
    if (animal && hasTool(have, 'wooden_sword')) return open({ skill: 'hunt', args: { animal }, why: `food: ${foodCarried} carried`, timeout: 60 });
    // None in sight, and nearly out: to where the atlas last saw some, if that is near enough
    // to be back by dusk. (It used to wait for an animal to walk past.)
    const seen = foodCarried < 3 && time < 8000 && hasTool(have, 'wooden_sword') ? world.knows(ANIMALS.filter((name) => !(chicks && name === 'chicken'))) : null;
    if (seen && seen.far <= 110) return open({ skill: 'goto', args: { x: seen.x, z: seen.z, range: 8 }, why: `food: ${foodCarried} carried, and ${seen.name} was seen ${seen.far} blocks off`, timeout: 240 });
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

  // The base is kept up. Turn 7: a creeper blew the bed out of the base, the next death put the
  // player back at the world's spawn point in a treetop, and nothing put the bed back because
  // every base goal stopped at "has slept once". What is remembered is checked against the world.
  memory.baseHas ??= {};
  // Turn 9: the base's table used to be whatever table was put down last, anywhere. Seed the
  // new record from the old one once, when that old one really is in the room.
  if (!memory.baseHas.crafting_table && memory.base && memory.places?.crafting_table?.y === memory.base.y
    && Math.abs(memory.places.crafting_table.x - memory.base.x) <= 1 && Math.abs(memory.places.crafting_table.z - memory.base.z) <= 1) {
    memory.baseHas.crafting_table = memory.places.crafting_table;
  }
  for (const [thing, where] of [['bed', memory.places], ['crafting_table', memory.baseHas]]) {
    const at = where?.[thing];
    const name = at && fromHome < 40 ? api.nameAt(new api.Vec3(at.x, at.y, at.z)) : null;
    if (name && !(thing === 'bed' ? name.endsWith('_bed') : name === thing)) {
      delete where[thing];
      if (thing === 'bed') memory.spawnBed = false;
    }
  }
  // After a death, waking up far from the bed means the bed no longer holds the spawn point.
  memory.danger = (memory.danger ?? []).filter((zone) => zone.until > now);
  if (memory.lastDeath && memory.respawnSeen !== memory.lastDeath.at) {
    memory.respawnSeen = memory.lastDeath.at;
    // Where it died under ground is kept away from for an hour: nothing there is fetched or dug.
    const died = memory.lastDeath.where;
    // Not by its own base: at 09:52 on 2026-10-04 it suffocated under gravel 5 blocks from its
    // bed, and the mark kept it from its own things and from everything round its base.
    const byHome = home && Math.hypot(died.x - home.x, died.z - home.z) < 40;
    if (died && died.y < 55 && !byHome) memory.danger.push({ ...died, r: 24, until: now + 3600000, why: 'died here' });
    const at = memory.places?.bed;
    if (!at || Math.hypot(here.x - at.x, here.y - at.y, here.z - at.z) > 8) memory.spawnBed = false;
  }
  const bedTime = time >= 12541 && time < 23300;
  // A chest that would take no more is left alone for half an hour. On 2026-10-04, with 26
  // diamonds and a full chest, the player walked to the chest, failed to put them in, climbed
  // out for its next goal, and walked back, round and round (learn() notes the full chest).
  const chestFull = now - (memory.chestFull ?? 0) < 1800000;
  // The people in the game: every player that is not this one and not a program's.
  const people = Object.keys(bot.players ?? {}).filter((name) => name !== bot.username && !/codex|bot$/i.test(name));

  function bed() {
    if (bedHad || memory.places?.bed) return null;
    // The flock by the spawn point was three white sheep and a black one. The game's recipe
    // book (probed live) makes white wool from black wool and white dye, and white dye from a
    // lily of the valley or bone meal. So the third fleece need not be a fourth sheep.
    if ((have.white_wool ?? 0) < 3 && (have.white_wool ?? 0) + (have.black_wool ?? 0) >= 3) {
      const dye = (skill, args, why) => open({ skill, args, why, timeout: 90 });
      if (have.white_dye) return dye('craft', { item: 'white_wool', times: 1 }, 'black wool dyed white for the bed');
      if (have.lily_of_the_valley || have.bone_meal) return dye('craft', { item: 'white_dye', times: 1 }, 'white dye for the black wool');
      if (have.bone) return dye('craft', { item: 'bone_meal', times: 1 }, 'bone meal for white dye');
      const dusk = time < 14500 && fromHome < 60;
      const lily = (!world.night || dusk) && world.sees('lily_of_the_valley') && dye('collect', { block: 'lily_of_the_valley', count: 1 }, 'a lily makes white dye for the black wool');
      if (lily) return world.night ? { ...lily, pass: { night: true } } : lily;
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
    if (!home) return null;
    // The first base is the room, the crafting table and the bed. The furnace follows the race.
    const tableIn = memory.base && !!memory.baseHas?.crafting_table;
    const furnished = memory.base && tableIn;
    const bedToPlace = bedHad && !memory.places?.bed;
    // A chest for the base, once there is a room with a table in it. It is made at the surface
    // or wherever the wood is, and put down the next time the player is home.
    if (furnished && !bedToPlace && !memory.baseHas?.chest) {
      if (!(have.chest > 0)) { const make = plan('chest', 1, world); return make?.stuck ? null : make; }
      if (fromHome > 12 && world.night) return null;
      if (fromHome > 12 && (Math.abs(here.y - memory.base.y) > 20 || fromHome > 80)) return null;   // it goes down when home is near
      if (fromHome > 12) return { skill: 'goto', args: { x: home.x, z: home.z, range: 4 }, why: 'the chest goes in the base', timeout: 300 };
      // From far below, up in legs first: a long climb asked for in one piece is not climbed (turn 11).
      if (memory.base.y - here.y > 16) return open({ skill: 'surface', args: {}, why: 'up to the base with the chest', timeout: 600 });
      return open({ skill: 'build_base', args: {}, why: 'the chest goes in the base', timeout: 240 });
    }
    if (furnished && !bedToPlace) return null;
    if (!memory.base || !furnished) {
      const table = (have.crafting_table ?? 0) >= 1 ? null : plan('crafting_table', 1, world);
      if (table) return table;
    }
    // With the bed in the pack the walk home is worth a short run in the dark.
    const dash = fromHome > 12 && world.night && bedToPlace && fromHome < 120;
    if (fromHome > 12 && world.night && !dash) return { stuck: 'the walk home waits for morning' };
    if (fromHome > 12) return { skill: 'goto', args: { x: home.x, z: home.z, range: 4 }, why: 'the base is dug at home', timeout: dash ? 90 : 300, ...(dash && { pass: { night: true, brave: true } }) };
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
    // A full pack stops everything that makes or picks up a thing. Away from the base's chest,
    // what is not worth a place is thrown away.
    ['room in the pack', () => {
      if (bot.inventory.emptySlotCount() > 1) return null;
      const b = memory.base;
      const atChest = memory.baseHas?.chest && b && Math.abs(here.x - b.x) <= 3 && Math.abs(here.z - b.z) <= 3 && Math.abs(here.y - b.y) <= 2;
      // With work open on the land the earth and the wood are wanted: make_room keeps them.
      const working = (memory.works ?? []).some((w) => !w.done);
      return atChest ? null : open({ skill: working ? 'make_room' : 'drop_junk', args: {}, why: 'the pack is full', timeout: 30 });
    }],
    // Junk taken out of the chest leaves the base with the player and is thrown away outside.
    ['junk out', () => {
      const b = memory.base;
      const nearBase = b && Math.abs(here.x - b.x) <= 6 && Math.abs(here.z - b.z) <= 6 && Math.abs(here.y - b.y) <= 6;
      const junk = ['cobbled_deepslate', 'tuff', 'diorite', 'andesite', 'granite', 'gravel'].reduce((sum, name) => sum + (have[name] ?? 0), 0);
      return !nearBase && junk >= 128 ? open({ skill: 'drop_junk', args: {}, why: `${junk} blocks of stone that are no use`, timeout: 30 }) : null;
    }],
    ['recover', recover],
    // After a death the pack is empty and the chest in the base is not. Before wood is cut for a
    // wooden pickaxe, what the chest holds is taken: armour, tools, and diamonds to make the rest.
    ['kit', () => {
      const chest = memory.baseHas?.chest;
      const b = memory.base;
      if (!chest || !b || fromHome > 80) return null;
      // Once the chest has been looked into, what it holds is known: the trip is made when it
      // has something the player is the better for, diamonds for missing diamond things included.
      // Before that, when the player is without an iron pickaxe or a chestplate.
      const lacks = !hasTool(have, 'iron_pickaxe') || !Object.keys(have).some((name) => /^(iron|diamond|netherite)_chestplate$/.test(name));
      if (memory.chest ? !api.kitWants().length : !lacks) return null;
      const inside = Math.abs(here.x - 0.5 - b.x) <= 2.6 && Math.abs(here.z - 0.5 - b.z) <= 2.6 && Math.abs(here.y - b.y) <= 2;
      if (inside) return open({ skill: 'kit', args: { at: chest }, why: 'what the chest holds, before making anything again', timeout: 60 });
      if (world.night && world.exposed) return null;
      // From under ground, up first: the walk asked for from 46 blocks off at y 53 was thought
      // about for 45 s and not walked (09:18 on 2026-10-04).
      if (!world.exposed && world.y < world.surfaceY - 6) return open({ skill: 'surface', args: {}, why: 'up, and then to the chest in the base', timeout: 600 });
      return open({ skill: 'goto', args: { x: b.x, y: b.y, z: b.z, range: 1 }, why: 'to the chest in the base for armour, tools and diamonds', timeout: 240 });
    }],
    // During the race the bed came before tools. It is won; a bed that is carried still goes back first.
    ...(bedHad && !memory.places?.bed ? [['base', base]] : []),
    ['pickaxe', tool('wooden_pickaxe')],
    // CT, 2026-10-03: a race with Codex's player to a base and a night in a bed near the
    // spawn point. The bed is three wool, so sheep come before everything but a pickaxe.
    // The night passes when every player is in a bed (for a few hours on 2026-10-04 one sleeper
    // was enough; CT put the rule back). So this player is in its bed at dusk whenever it is
    // near it: it must not be the one holding the night up, and a night slept in the bed also
    // makes the base the place to wake up after a death.
    ['home by dusk', () => {
      if (!home || !memory.places?.bed || time < 10300 || time > 14200 || fromHome > 160) return null;
      if (now < (memory.noBedUntil ?? 0)) return null;
      // From deep in a mine too: with every player needed in a bed, a player that stays down
      // its mine holds the night up for everyone. Up in legs first, then the walk.
      const below = memory.places.bed.y - here.y;
      if (below > 16) return open({ skill: 'surface', args: {}, why: 'up from the mine to be in bed at dusk', timeout: 600, pass: { night: true } });
      if (fromHome < 20) return null;
      // The last stretch may run past dark: the pass lasts as long as this one walk.
      return { skill: 'goto', args: { x: home.x, z: home.z, range: 6 }, why: 'to be in bed at dusk', timeout: 120, pass: { night: true } };
    }],
    ['sleep', () => {
      if (!memory.places?.bed || fromHome > 60 || !(bedTime || (time >= 12300 && time < 12541))) return null;
      // Asked three times tonight and the others stayed up: no more bed until morning.
      if (now < (memory.noBedUntil ?? 0)) return null;
      // Turn 11: from 56 blocks under its bed it set off for it 4 times, 100 s each, and never
      // arrived. Deep under ground the night does not matter: the bed is for when it is near.
      if (Math.abs(here.y - memory.places.bed.y) > 20) return null;
      // Turn 7: the walk to the bed kept being stopped by the reflex that digs in at night.
      return open({ skill: 'sleep', args: {}, why: 'a night in the bed is a night skipped', timeout: 130, pass: { night: true } });
    }],
    ['into the base', () => {
      if (!(memory.base && api.night() && api.exposed() && fromHome < 20)) return null;
      return { skill: 'goto', args: { x: memory.base.x, y: memory.base.y, z: memory.base.z, range: 1 }, why: 'the night is spent in the base', timeout: 90, pass: { night: true } };
    }],
    // By day, inside the base with the doorway shut: open it. Nothing else can start from in there.
    ['out of the base', () => {
      const b = memory.base;
      if (!b || world.night) return null;
      const inside = Math.abs(here.x - 0.5 - b.x) <= 1.6 && Math.abs(here.z - 0.5 - b.z) <= 1.6 && Math.abs(here.y - b.y) <= 1.6;
      const shut = api.solid(new api.Vec3(b.x + 2, b.y, b.z)) || api.solid(new api.Vec3(b.x + 2, b.y + 1, b.z));
      return inside && shut ? open({ skill: 'leave_base', args: {}, why: 'the doorway was closed for the night', timeout: 60 }) : null;
    }],
    // The farm is worked (CT, 2026-10-04: "work the farm so you will have food"): looked over
    // every five minutes by day for what is ripe, cut, sown again, and the wheat baked.
    ['the farm', () => {
      const field = memory.farmField;
      if (!field || world.night || time > 11000 || now - (field.tendedAt ?? 0) < 300000) return null;
      if (!world.exposed && world.y < world.surfaceY - 6) return null;
      if (Math.hypot(here.x - field.x - 10, here.z - field.z - 5) > 120) return null;
      return open({ skill: 'tend', args: {}, why: 'the farm is looked over for what is ripe', timeout: 240 });
    }],
    // What is gathered is kept. Once there is a storehouse (memory.store, from skills/build.mjs),
    // a pack that is nearly full is emptied into it by day: on 2026-10-04 the pack was full from
    // morning to night, the one chest in the base too, and stone, saplings and seeds' worth of
    // room were thrown on the ground. Worth the walk from anywhere near; done in passing when close.
    ['store', () => {
      const house = memory.store;
      if (!house || world.night || time > 11400 || now - (house.fullAt ?? 0) < 1800000) return null;
      if (!world.exposed && world.y < world.surfaceY - 6) return null;
      const far = Math.hypot(here.x - house.door.outside.x, here.z - house.door.outside.z);
      const free = bot.inventory.emptySlotCount();
      if (far > 120 || !(free <= 4 || (far < 24 && free <= 12))) return null;
      return open({ skill: 'store', args: {}, why: `${36 - free} of 36 places in the pack are taken`, timeout: 120 });
    }],
    // Work a person asked for on the land (a farm, ground levelled, trees felled: land.mjs
    // reads the request, skills/work.mjs does one piece of it and looks at the world again).
    // By day, and not begun so late that dusk finds the player out in the field: on 2026-10-04
    // the night reflex dug its shelter in the middle of the farm it was building.
    ['works', () => {
      // Sowing is slow (seeds come a few at a time from grass) and never urgent: it goes last,
      // and a job whose step has just failed gives way to the next one.
      const jobs = (memory.works ?? []).filter((w) => !w.done).sort((a, b) => (a.kind === 'sow') - (b.kind === 'sow'));
      const stepFor = (w) => ({ skill: 'work', args: { id: w.id }, why: `${w.kind}, asked for by ${w.by}`, timeout: Math.max(60, Math.min(600, Math.round((12300 - time) / 20))) });
      const job = jobs.find((w) => !world.blocked(stepFor(w))) ?? jobs[0];
      if (!job || world.night || time > 11200) return null;
      // Felling is paid for in falls: the first morning of it took the player from 20 health to
      // 14. Hurt, the work waits. (It also waited when fewer than 2 pieces of food were carried,
      // and on the morning of game day 66 that was every job stopped by one apple: with no
      // animal in sight there was nothing the food goal could do. Food is the farm's to give.)
      if (bot.health < 12) return null;
      return open({ skill: 'work', args: { id: job.id }, why: `${job.kind}, asked for by ${job.by}`, timeout: Math.max(60, Math.min(600, Math.round((12300 - time) / 20))) })
        ?? { stuck: `the ${job.kind} ${job.by} asked for keeps failing` };
    }],
    // A chest in the base, and what is not needed on a trip put into it whenever the player is
    // in the room: every death under ground so far took everything it had made.
    ['stash', () => {
      const chest = memory.baseHas?.chest;
      const b = memory.base;
      if (!chest || !b || chestFull) return null;
      const inside = Math.abs(here.x - 0.5 - b.x) <= 2.6 && Math.abs(here.z - 0.5 - b.z) <= 2.6 && Math.abs(here.y - b.y) <= 2;
      // What counts as a spare is lib.mjs's to say, so that this goal and the skill agree: they
      // did not, and the goal asked ten times for a stash that had nothing it would put in.
      return inside && api.spares().length ? open({ skill: 'stash', args: { at: chest }, why: 'spares go in the chest before the next trip', timeout: 60 }) : null;
    }],
    // Diamonds are carried home before more are dug: at 07:15 it had 54 on it, 40 blocks under
    // ground beside a mineshaft that had already killed it once, and a chest it could not fill.
    ['bank', () => {
      const chest = memory.baseHas?.chest;
      const b = memory.base;
      if (!chest || !b || (have.diamond ?? 0) < 16 || world.night || chestFull) return null;
      if (Math.abs(here.x - 0.5 - b.x) <= 2.6 && Math.abs(here.z - 0.5 - b.z) <= 2.6 && Math.abs(here.y - b.y) <= 2) return null;
      const why = `${have.diamond} diamonds to the chest`;
      if (b.y - here.y > 16) return open({ skill: 'surface', args: {}, why, timeout: 600 });
      return open({ skill: 'goto', args: { x: b.x, y: b.y, z: b.z, range: 1 }, why, timeout: 300 });
    }],
    ['sword', tool('stone_sword')],
    ['stone pickaxe', tool('stone_pickaxe')],
    ['base', base],
    ['bed', bed],
    // Turn 11: 60 blocks down its last pickaxe wore out with no stick to make another, and it
    // dug its way up by hand for more than 3 minutes. Before going down: sticks for two tools
    // and wood for a table. Only asked for at the surface; under ground it works with what it has.
    ['provisions', () => {
      const count = (ending) => Object.entries(have).filter(([name]) => name.endsWith(ending)).reduce((sum, [, n]) => sum + n, 0);
      const wood = count('_log') * 4 + count('_planks');
      const sticks = have.stick ?? 0;
      if ((sticks >= 4 && wood >= 6) || world.night) return null;
      if (!world.exposed && world.y < world.surfaceY - 6) return null;
      if (wood < 8) return plan(`${world.wood}_log`, count('_log') + 2, world);
      return plan('stick', 4, world);
    }],
    // The Parrots and the Bats: breed two animals. Chickens take seeds, and both are close to
    // hand. Only when two chickens are in sight; it is not worth a search. Before food: see food().
    ['The Parrots and the Bats', () => {
      if (earned.includes('The Parrots and the Bats') || world.night) return null;
      if (world.creatures.filter((name) => name === 'chicken').length < 2) return null;
      if ((have.wheat_seeds ?? 0) < 2) return plan('wheat_seeds', 2, world);
      return open({ skill: 'breed', args: { animal: 'chicken', food: 'wheat_seeds' }, why: 'two chickens in sight and seeds in the pack', timeout: 90 });
    }],
    ['food', food],
    ['A Seedy Place', seedy],
    ['iron pickaxe', tool('iron_pickaxe')],
    // Iron armour is wanted only where nothing as good or better is had: with the diamond set on
    // and the iron set in the chest, it went back down for iron for a second iron chestplate (turn 12).
    ['Suit Up', tool('iron_chestplate')],
    ['shield', item('shield')],
    ['iron sword', tool('iron_sword')],
    ['leggings', tool('iron_leggings')],
    ['helmet', tool('iron_helmet')],
    ['boots', tool('iron_boots')],
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
    // The curriculum (curriculum.mjs, and RESEARCH.md for where the idea is from): the game's
    // own list of advancements, surveyed for what is open and what the planner has a step for
    // now. The first such step is taken. What is open with no way is kept in memory for the
    // report: it is what the session is asked to write next.
    ['curriculum', () => {
      if (!curriculum) return null;
      // No trip is begun in the late afternoon (it started down for lava at 16:20 by the game's
      // clock and "home by dusk" called it back up 20 s later), nor at night with a person in
      // the game: the night's work then stays in reach of the bed.
      if ((memory.places?.bed && time >= 10000 && time < 12600) || (world.night && people.length)) {
        memory.curriculum = { ...(memory.curriculum ?? {}), held: 'no trips late in the day, or at night with a person in the game' };
        return null;
      }
      const rows = curriculum.survey(advancements, earned, { have, plan: (item) => plan(item, 1, world) });
      memory.curriculum = { at: now, ...curriculum.summary(rows) };
      const first = curriculum.next(rows);
      return first ? { ...first.step, why: `${first.title}: ${first.step.why ?? first.item}` } : null;
    }],
    // fogsift, 07:38 on 2026-10-04: "prepare to get some crops going". A hoe, seeds, and a plot
    // of wheat beside water, by day and near home, when everything above is done. The plot is
    // looked at again every ten minutes for wheat that is ripe.
    ['crops', () => {
      // Not in the late afternoon: seeds are gathered 30 blocks out, "home by dusk" calls it
      // back from 20, and the two took turns from 09:01 on 2026-10-04 until the bed would take it.
      if (world.night || !home || fromHome > 100 || (memory.places?.bed && time >= 10000)) return null;
      if (!Object.keys(have).some((name) => name.endsWith('_hoe'))) return plan('wooden_hoe', 1, world);
      const seeds = have.wheat_seeds ?? 0;
      if (seeds < 6 && !(memory.farm?.planted >= 6)) return open({ skill: 'gather_seeds', args: { count: 6 - seeds }, why: `${seeds} seeds, and 6 make a plot`, timeout: 120 });
      const tended = memory.farm?.at && now - memory.farm.at < 600000;
      if (seeds > 0 || (memory.farm && !tended)) return open({ skill: 'farm', args: {}, why: seeds ? `${seeds} seeds to plant beside water` : 'a look at the plot for ripe wheat', timeout: 180 });
      return null;
    }],
    // A night the others would not sleep through is spent under ground, after diamonds: they
    // are what everything further on is made of, and under ground the night does not matter.
    // With a person in the game, the night's digging stays where the bed can be reached when
    // they ask: coal (torches for a bigger base) or iron, neither more than about 45 blocks
    // under the bed. On 2026-10-04 fogsift asked three times for everyone to sleep while this
    // player was 113 blocks down after diamonds, and it told him it would stay in reach.
    ['mining', () => {
      if (!world.night) return null;
      if (!people.length || !memory.places?.bed) return plan('diamond', (have.diamond ?? 0) + 3, world);
      const coal = plan('coal', (have.coal ?? 0) + 8, world);
      return coal && !coal.stuck ? coal : plan('raw_iron', (have.raw_iron ?? 0) + 3, world);
    }],
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
  // Nothing left on the list (turn 12: full diamond armour on, and it stood still). By day:
  // up to the surface and a look around, which is where animals to breed and new country are.
  // Not further than 120 blocks from home, so that the bed can be reached by dusk.
  // From late afternoon it stays by its bed. At 07:47 on 2026-10-04 a look around walked 29
  // blocks east, "home by dusk" called it back, and so on every 10 s until the bed would take it.
  const nearlyDusk = !!(home && memory.places?.bed && time >= 10300);
  if (!world.night && !nearlyDusk) {
    // Each way is tried in turn. Turn 13: the first was the only one tried, and when the climb
    // to the surface was marked as failing nothing else was, so it stood still all day.
    const ways = [];
    if (!world.exposed && world.y < world.surfaceY - 6) ways.push(open({ skill: 'surface', args: {}, why: 'nothing left to do down here', timeout: 600 }));
    if (home && fromHome > 120) {
      // Each time it turns for home, the next look is a quarter turn round: it had walked the
      // same 120 blocks north twice.
      memory.heading = DIRECTIONS[(DIRECTIONS.indexOf(memory.heading ?? 'north') + 1) % 4];
      ways.push({ skill: 'goto', args: { x: home.x, z: home.z, range: 8 }, why: 'far enough from home', timeout: 300 });
    }
    ways.push(heading({ skill: 'explore', args: {}, why: 'nothing left on the list: a look around', timeout: 90 }, memory, world));
    const step = ways.find(Boolean);
    if (step) {
      memory.thought = { at: new Date().toISOString(), goal: 'look around', step: `${step.skill} ${JSON.stringify(step.args)}`, why: step.why, stuck };
      return { goal: 'look around', ...step };
    }
  }
  memory.thought = { at: new Date().toISOString(), goal: nearlyDusk && !world.night ? 'by my bed until dusk' : null, step: null, stuck };
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
  // "fogsift asked" and "the game asked" are how a chat order and the sleepers' count stop a step.
  const interrupted = /^reflex:|night|died|asked|disconnected|process stopping/.test(row.note ?? '');
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
  if (row.skill === 'stash' && !row.ok && /destination full/.test(row.note ?? '')) memory.chestFull = Date.now();
  if (row.skill === 'come') delete memory.order;
  // A follow that ended for any reason but a reflex (a fight, a creeper) is over: the time was
  // up, the person went out of sight, or someone said stop.
  if (row.skill === 'follow' && memory.order?.kind === 'follow' && !/^reflex:/.test(row.note ?? '')) delete memory.order;
  // A bed order is not ended by a sleep that worked: it ends with the night (think() drops it).
  if (row.skill === 'sleep' && row.ok) memory.spawnBed = true;
  // A table that could not be taken back is let go of, so it is not tried for ever.
  if (row.skill === 'take_back' && !row.ok && row.args?.at) {
    const at = row.args.at;
    memory.own = (memory.own ?? []).filter((o) => !(o.at.x === at.x && o.at.y === at.y && o.at.z === at.z));
  }
}
