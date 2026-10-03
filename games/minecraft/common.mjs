// What both Minecraft bodies share. The game can be played by a hidden bot (fast, in the
// background) or through the real game window with keys and mouse (what a person sees).
// Either way the player is called LocalModel, the actions have the same names, and the
// playbook, the milestones and the rules are the same, so what is learned with one body
// carries to the other.

export const BOT_NAME = 'LocalModel';
export const DIRECTIONS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
export const NEEDS_PICKAXE = /^(stone|cobblestone|coal_ore|iron_ore|copper_ore|deepslate)$/;
export const NEEDS_STONE_PICKAXE = /^(iron_ore|copper_ore)$/;
export const TOOL_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
export const COLLECTIBLE = /_log$|^stone$|^cobblestone$|^coal_ore$|^iron_ore$|^sand$/;
export const NOTICED_SINGLY = ['crafting_table', 'stone', 'coal_ore', 'iron_ore', 'furnace'];
export const CRAFTABLE = [
  'planks', 'stick', 'crafting_table', 'wooden_pickaxe', 'wooden_axe', 'wooden_sword',
  'stone_pickaxe', 'stone_axe', 'stone_sword', 'furnace', 'torch',
];
export const MILESTONES = [
  [/_log$/, 'first_log'], [/_planks$/, 'planks'], [/^crafting_table$/, 'crafting_table'], [/^stick$/, 'sticks'],
  [/^wooden_pickaxe$/, 'wooden_pickaxe'], [/^cobblestone$/, 'cobblestone'], [/^stone_pickaxe$/, 'stone_pickaxe'],
  [/^coal$/, 'coal'], [/^furnace$/, 'furnace'], [/^raw_iron$/, 'iron'],
];

// What a block leaves behind when it is dug. A dig is done when this is carried, not when
// anything at all was picked up: dirt dug on the way is not the ore that was asked for.
const DROPS = { stone: 'cobblestone', coal_ore: 'coal', iron_ore: 'raw_iron', copper_ore: 'raw_copper', deepslate: 'cobbled_deepslate' };
export const dropOf = (block) => DROPS[block] ?? block;

// How many blocks a log stands above the ground under it: 0 for the foot of a trunk. Air,
// leaves and other logs are not ground, so a branch out in the canopy counts from the
// forest floor. blockAt(x, y, z) gives a block's name, or null where the world is not loaded.
// A person fells a tree from the ground, taking the logs they can reach: 0 to 3.
export function heightAboveGround(blockAt, at, limit = 24) {
  for (let down = 1; down <= limit; down++) {
    const name = blockAt(at.x, at.y - down, at.z);
    if (!name) return Infinity;
    if (name === 'air' || name === 'cave_air' || name.endsWith('_leaves') || name.endsWith('_log') || name === 'vine') continue;
    return down - 1;
  }
  return Infinity;
}
export const TRUNK_REACH = 3;

// Recipes as a person lays them out in the crafting grid, top row first. '#log' is any
// log, '#planks' any planks. The hidden bot asks the game for recipes; the real window has
// to click them into place, so it needs the shapes.
const P = '#planks';
const C = 'cobblestone';
const S = 'stick';
export const RECIPES = {
  planks: { grid: [['#log']], table: false },
  stick: { grid: [[P], [P]], table: false },
  crafting_table: { grid: [[P, P], [P, P]], table: false },
  torch: { grid: [['coal'], [S]], table: false },
  wooden_pickaxe: { grid: [[P, P, P], [null, S, null], [null, S, null]], table: true },
  wooden_axe: { grid: [[P, P, null], [P, S, null], [null, S, null]], table: true },
  wooden_sword: { grid: [[P], [P], [S]], table: true },
  stone_pickaxe: { grid: [[C, C, C], [null, S, null], [null, S, null]], table: true },
  stone_axe: { grid: [[C, C, null], [C, S, null], [null, S, null]], table: true },
  stone_sword: { grid: [[C], [C], [S]], table: true },
  furnace: { grid: [[C, C, C], [C, null, C], [C, C, C]], table: true },
};

// Does an item name satisfy a recipe ingredient?
export const fits = (ingredient, item) =>
  ingredient === '#log' ? item.endsWith('_log') : ingredient === '#planks' ? item.endsWith('_planks') : ingredient === item;

// How many of each ingredient a recipe needs: { '#planks': 3, stick: 2 }.
export function needs(recipe) {
  const out = {};
  for (const cell of recipe.grid.flat()) if (cell) out[cell] = (out[cell] ?? 0) + 1;
  return out;
}

export function describeText() {
  return [
    'You are a player in Minecraft survival, starting with nothing.',
    'Get as far as you can: wood, then planks, a crafting table, sticks, a wooden pickaxe, then stone and a stone pickaxe.',
    'collect digs one block and picks it up. craft makes an item from what you carry.',
    'Tools need a crafting table placed on the ground nearby. Stone needs a pickaxe.',
    'At night monsters come. If your health reaches 0 the run ends.',
  ].join(' ');
}

// The kinds of action this game has. The exact names depend on what is nearby and what is
// carried; a skill reads them from api.primitives().
export function vocabularyList() {
  return [
    { name: 'collect:<block>', about: 'walk to the nearest block of that kind and dig one, for example collect:oak_log or collect:stone. Offered only for blocks within 32 blocks; stone and ores only when a pickaxe is carried. Result: { ok, got: { item: count } }' },
    { name: 'craft:<item>', about: `make one of: ${CRAFTABLE.join(', ')}. Offered only when what is carried is enough (and a crafting table is within 32 blocks for tools). craft:planks turns 1 log into 4 planks. Result: { ok, made }` },
    { name: 'place:crafting_table', about: 'put a carried crafting table on the ground. Offered when one is carried and none is within 8 blocks. A craft that needs a table uses the nearest one within 32 blocks and walks to it, so far from the old table it is quicker to craft and place a new one.' },
    { name: 'explore:<north|south|east|west>', about: 'walk about 24 blocks that way. Always offered.' },
    { name: '(observation)', about: 'observe() gives { time: day or night, health 0 to 20, food, pos, carrying: { item: count }, nearest: { block: distance }, monsters: { name: distance } }' },
  ];
}

// Items gained between two inventories, as events, with any milestone reached for the first time.
export function gainEvents(before, after, reached, announce = () => {}) {
  const events = [];
  for (const [item, count] of Object.entries(after)) {
    if (count <= (before[item] ?? 0)) continue;
    events.push({ kind: 'item', detail: { item, count } });
    for (const [pattern, milestone] of MILESTONES) {
      if (pattern.test(item) && !reached.has(milestone)) {
        reached.add(milestone);
        events.push({ kind: 'milestone', detail: { name: milestone } });
        announce(milestone);
      }
    }
  }
  return events;
}

// Where two counts of what is carried differ: { item: [first, second] }. Empty when they agree.
export function carriedDiffers(first, second) {
  const out = {};
  for (const item of new Set([...Object.keys(first), ...Object.keys(second)])) {
    if ((first[item] ?? 0) !== (second[item] ?? 0)) out[item] = [first[item] ?? 0, second[item] ?? 0];
  }
  return out;
}

export function runMetrics(events, walked) {
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
}
