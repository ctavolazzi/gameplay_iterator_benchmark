// The planner: given an item to have and what the world looks like right now, the one next
// skill call that moves toward it. It is asked again after every step, so it never holds a
// plan that the world has moved on from. It knows three ways to get a thing: take it from
// the world (SOURCES), smelt it (SMELTS), or craft it from the game's own recipe book.
//
// It touches nothing but the world object it is handed, so tests run it with a made-up one:
//   have        { item: count }, carried and worn
//   wood        the wood being worked in, 'oak'
//   recipes(n)  [{ uses: { item: count }, makes, table }] from the game's recipe book
//   sees(b)     true when a block of that kind (or 'log') can be reached from here
//   creatures   names of creatures in sight
//   near        { crafting_table, furnace }: a placed one close enough to use
//   night       true when the surface is not safe
//   exposed     true when the player stands under the open sky
//   y, surfaceY where the player is, and where the ground is
//   blocked(s)  true when that exact step has been failing

export const TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'];

export const SMELTS = {
  iron_ingot: 'raw_iron', copper_ingot: 'raw_copper', gold_ingot: 'raw_gold', glass: 'sand',
  cooked_beef: 'beef', cooked_porkchop: 'porkchop', cooked_mutton: 'mutton', cooked_chicken: 'chicken',
};

// deeper: the height at or below which the block is common, when it has to be dug for.
export const SOURCES = {
  cobblestone: { blocks: ['stone'], tool: 'wooden_pickaxe', deeper: 58, least: 4 },
  cobbled_deepslate: { blocks: ['deepslate'], tool: 'wooden_pickaxe' },   // taken when in sight, never dug down for
  coal: { blocks: ['coal_ore', 'deepslate_coal_ore'], tool: 'wooden_pickaxe', deeper: 44, least: 2 },
  raw_iron: { blocks: ['iron_ore', 'deepslate_iron_ore'], tool: 'stone_pickaxe', deeper: 16 },
  raw_copper: { blocks: ['copper_ore', 'deepslate_copper_ore'], tool: 'stone_pickaxe', deeper: 44 },
  raw_gold: { blocks: ['deepslate_gold_ore', 'gold_ore'], tool: 'iron_pickaxe', deeper: -16 },
  diamond: { blocks: ['deepslate_diamond_ore', 'diamond_ore'], tool: 'iron_pickaxe', deeper: -54 },
  dirt: { blocks: ['dirt', 'grass_block'] },
  sand: { blocks: ['sand'], surface: true },
  gravel: { blocks: ['gravel'] },
  wheat_seeds: { skill: 'gather_seeds', sees: 'short_grass', surface: true },
  beef: { hunt: 'cow' }, leather: { hunt: 'cow' }, porkchop: { hunt: 'pig' },
  mutton: { hunt: 'sheep' }, chicken: { hunt: 'chicken' }, feather: { hunt: 'chicken' },
};

// bamboo_planks is in here because the live recipe book has it: left out, it tied with oak and won.
const WOODY = /^(?:stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_(planks|log|wood|stem|hyphae|block)$/;

// True when a tool of this kind is carried at this tier or better: any pickaxe is a wooden pickaxe.
export function hasTool(have, least) {
  const cut = least.indexOf('_');
  const kind = least.slice(cut + 1);
  return TIERS.slice(TIERS.indexOf(least.slice(0, cut))).some((tier) => (have[`${tier}_${kind}`] ?? 0) > 0);
}

// What a failing step is remembered by: the skill and what it was after, not how many.
export function signature(step) {
  const a = step.args ?? {};
  return `${step.skill}:${a.block ?? a.item ?? a.input ?? a.animal ?? a.direction ?? ''}`;
}

// Whether the player's own crafting table or furnace close by should be picked up before
// this step. Only when the step really leaves: the first version (turn 5) picked up before
// every step that was not a craft or a smelt, so digging coal for the furnace meant taking
// the furnace along and putting it straight back. In one hour: 175 times, 169 of them put
// down again within 3 steps, 29% of all the time spent on steps.
//   far: how many blocks away the step's target is, when it has one
export function leaves(step, far = null) {
  if (['explore', 'goto', 'descend', 'surface', 'recover', 'hunt'].includes(step.skill)) return true;
  if (step.skill === 'collect') return far !== null && far > 16;
  return false;
}

export function plan(item, count, world) {
  return need(item, count, world, []);
}

function need(item, count, w, trail) {
  const have = w.have[item] ?? 0;
  if (have >= count) return null;
  if (trail.includes(item)) return { stuck: `${item} needs itself` };
  if (trail.length > 8) return { stuck: `${item} is too many steps away` };
  const missing = count - have;
  const chain = [...trail, item];
  const why = [...chain].reverse().join(' for ');
  const step = (skill, args, timeout) => ({ skill, args, why, ...(timeout && { timeout }) });
  const open = (candidate) => (w.blocked(candidate) ? null : candidate);
  const underGround = !w.exposed && w.y < w.surfaceY - 6;

  // Something only found up top: wait for morning, climb out, or go looking.
  const onTheSurface = (thing) => {
    if (w.night) return { stuck: `${thing} waits for morning` };
    if (underGround) return open(step('surface', {}, 600)) ?? { stuck: 'cannot get back to the surface' };
    return null;
  };
  const explore = () => open(step('explore', {}, 90)) ?? { stuck: `nowhere left to look for ${item}` };

  if (/^[a-z_]+_log$/.test(item) && !item.startsWith('stripped_')) {
    const wait = onTheSurface('wood');
    if (wait) return wait;
    for (const block of [item, 'log']) {
      // A tree is a walk away: never fewer than 3 logs for the trip.
      const logs = Math.min(Math.max(missing, 3), 6);
      const take = w.sees(block) && open(step('collect', { block, count: logs }, 60 + 40 * logs));
      if (take) return take;
    }
    return explore();
  }

  const source = SOURCES[item] ?? (item.endsWith('_wool') ? { hunt: 'sheep' } : null);
  if (source) {
    if (source.tool && !hasTool(w.have, source.tool)) return need(source.tool, 1, w, chain) ?? { stuck: `no ${source.tool}` };
    if (source.blocks) {
      if (source.surface) { const wait = onTheSurface(item); if (wait) return wait; }
      const batch = Math.min(Math.max(missing, source.least ?? 1), 8);
      for (const block of source.blocks) {
        const take = w.sees(block) && open(step('collect', { block, count: batch }, 90 + 45 * batch));
        if (take) return take;
      }
      if (source.deeper !== undefined && w.y > source.deeper + 8) {
        const down = open(step('descend', { toY: Math.max(source.deeper, Math.floor(w.y) - 24) }, 300));
        if (down) return down;
      }
      if (w.night && w.exposed) return { stuck: `${item} waits for morning` };
      return explore();
    }
    const wait = onTheSurface(item);
    if (wait) return wait;
    if (source.hunt) return w.creatures.includes(source.hunt) ? (open(step('hunt', { animal: source.hunt }, 60)) ?? explore()) : explore();
    if (source.sees && !w.sees(source.sees)) return explore();
    return open(step(source.skill, { count: missing }, 150)) ?? explore();
  }

  if (SMELTS[item]) {
    const batch = Math.min(missing, 8);
    const first = need(SMELTS[item], batch, w, chain);
    if (first) return first;
    if (!w.near.furnace) {
      if (!(w.have.furnace > 0)) { const make = need('furnace', 1, w, chain); if (make) return make; }
      return open(step('place', { item: 'furnace' })) ?? { stuck: 'cannot put a furnace down' };
    }
    const fuel = pickFuel(w.have, batch);
    if (!fuel) {
      // Coal can be dug at night; wood cannot be fetched then.
      const coal = need('coal', Math.ceil(batch / 8), w, chain);
      if (coal && !coal.stuck) return coal;
      return need(`${w.wood}_planks`, Math.ceil(batch / 1.5), w, chain) ?? { stuck: 'no fuel' };
    }
    return open(step('smelt', { input: SMELTS[item], fuel, count: batch }, 60 + 12 * batch)) ?? { stuck: `smelting ${item} keeps failing` };
  }

  // Crafting. A recipe in another wood is not considered: one wood at a time.
  const recipes = w.recipes(item)
    .filter((recipe) => Object.keys(recipe.uses).every((name) => {
      const woody = WOODY.exec(name);
      return !woody || (woody[1] === w.wood && !name.startsWith('stripped_') && /_(planks|log)$/.test(name));
    }))
    .map((recipe) => {
      const crafts = Math.ceil(missing / recipe.makes);
      // What is missing, weighed by how hard each missing thing is to come by: stone that is
      // in sight beats deepslate that is 60 blocks down, though both make a stone pickaxe.
      const short = Object.entries(recipe.uses).reduce((sum, [name, n]) =>
        sum + Math.max(0, n * crafts - (w.have[name] ?? 0)) * ease(name, w), 0);
      return { ...recipe, crafts, short };
    })
    .sort((a, b) => a.short - b.short);
  if (!recipes.length) return { stuck: `no way known to get ${item}` };
  let last = null;
  for (const recipe of recipes.slice(0, 4)) {
    let waiting = null;
    for (const [name, n] of Object.entries(recipe.uses)) {
      waiting = need(name, n * recipe.crafts, w, chain);
      if (waiting) break;
    }
    if (waiting?.stuck) { last ??= waiting; continue; }   // the reason kept is the best recipe's
    if (waiting) return waiting;
    if (recipe.table && !w.near.crafting_table) {
      // A table the player already has, a walk away: go to it rather than make another (CT's note).
      if (w.tableKnown && !(w.have.crafting_table > 0)) {
        const walk = open(step('goto', { x: w.tableKnown.x, y: w.tableKnown.y, z: w.tableKnown.z, range: 3 }, 240));
        if (walk) return walk;
      }
      if (!(w.have.crafting_table > 0)) {
        const make = need('crafting_table', 1, w, chain);
        if (make?.stuck) { last ??= make; continue; }
        if (make) return make;
      }
      return open(step('place', { item: 'crafting_table' })) ?? { stuck: 'cannot put a crafting table down' };
    }
    return open(step('craft', { item, times: Math.min(recipe.crafts, 8) }, 90)) ?? { stuck: `crafting ${item} keeps failing` };
  }
  return last ?? { stuck: `no way known to get ${item}` };
}

// How hard a thing is to come by right now: 1 in sight, 2 made from other things, 3 has to
// be looked for, 9 no way known.
function ease(name, w) {
  const source = SOURCES[name];
  if (source?.blocks) return source.blocks.some((block) => w.sees(block)) ? 1 : 3;
  if (/^[a-z_]+_log$/.test(name)) return w.sees(name) || w.sees('log') ? 1 : 3;
  if (source || SMELTS[name] || name.endsWith('_wool')) return 2;
  return w.recipes(name).length ? 2 : 9;
}

// The fuel to burn for a number of items, from what is carried: coal first, then wood.
export function pickFuel(have, items) {
  for (const name of ['coal', 'charcoal']) if ((have[name] ?? 0) >= Math.ceil(items / 8)) return name;
  const wood = Object.keys(have).filter((name) => /_planks$|_log$/.test(name)).sort((a, b) => have[b] - have[a])[0];
  return wood && have[wood] >= Math.ceil(items / 1.5) ? wood : null;
}
