// Where things were seen. The player passes coal, sand, clay, a pumpkin, a flock of sheep, a
// stand of spruce, on its way to something else, and until now forgot each one the moment it
// was out of sight: the planner's answer to "I see no sand" was to walk 32 blocks in some
// direction. The atlas is what it has passed, kept in memory.atlas, so that the answer becomes
// "there was sand at -290 62 510". No game connection: lib.mjs prospect() does the looking.
//
// CT, 2026-10-04: "searching out new resources to build with and improve over time".
//
// atlas: { [name]: [{ x, y, z, n, seen }] }   one place per 16 by 16 by 16 block of the world
//   n     how many of it were seen there (the most at one look)
//   seen  when it was last seen there, in ms

// What is worth remembering. Not stone, earth or water: those are everywhere.
export const BLOCKS = [
  ...['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'].flatMap((ore) => [`${ore}_ore`, `deepslate_${ore}_ore`]),
  ...['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove'].map((wood) => `${wood}_log`),
  'sand', 'red_sand', 'clay', 'gravel', 'sugar_cane', 'pumpkin', 'melon', 'bamboo', 'cactus', 'sweet_berry_bush', 'cocoa',
  'obsidian', 'lava', 'bee_nest', 'hay_block', 'bell', 'spawner', 'lily_of_the_valley', 'wheat', 'carrots', 'potatoes', 'beetroots',
];
export const CREATURES = ['sheep', 'cow', 'pig', 'chicken', 'horse', 'villager', 'rabbit'];
const MOVES = new Set(CREATURES);
const PER_KIND = 10;
const CREATURE_AGE = 10 * 60000;   // a flock is where it was for about ten minutes

const cell = (p) => `${Math.floor(p.x / 16)},${Math.floor(p.y / 16)},${Math.floor(p.z / 16)}`;

// Add what one look found: sightings is [{ name, x, y, z }]. Sightings in one 16-block cell
// are one place, at the sighting nearest to `from`. Each kind keeps its PER_KIND nearest places to home.
export function note(atlas, sightings, now, from, home = from) {
  const groups = new Map();
  for (const s of sightings) {
    const key = `${s.name}|${cell(s)}`;
    const group = groups.get(key) ?? { name: s.name, n: 0, best: null, far: Infinity };
    group.n += 1;
    const far = Math.hypot(s.x - from.x, s.y - from.y, s.z - from.z);
    if (far < group.far) { group.far = far; group.best = s; }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const places = atlas[group.name] ??= [];
    const at = places.find((p) => cell(p) === cell(group.best));
    if (at) Object.assign(at, { x: group.best.x, y: group.best.y, z: group.best.z, n: Math.max(group.n, MOVES.has(group.name) ? 0 : at.n), seen: now });
    else places.push({ x: group.best.x, y: group.best.y, z: group.best.z, n: group.n, seen: now });
    if (places.length > PER_KIND) {
      places.sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
      places.length = PER_KIND;
    }
  }
  return atlas;
}

// Take out what is no longer so: a place within `radius` of where the player now stands, of a
// kind this look searched for, with none of it seen within 12 blocks of the place. (A block out
// of sight in a part of the world that is not loaded is not "gone": only what is near is judged.)
// Creatures are dropped when they have not been seen for ten minutes.
export function forget(atlas, sightings, now, from, radius = 24, looked = [...BLOCKS, ...CREATURES]) {
  let dropped = 0;
  for (const name of Object.keys(atlas)) {
    const seenNow = sightings.filter((s) => s.name === name);
    const before = atlas[name].length;
    atlas[name] = atlas[name].filter((p) => {
      if (MOVES.has(name)) return now - p.seen < CREATURE_AGE;
      if (!looked.includes(name) || Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z) > radius) return true;
      return seenNow.some((s) => Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z) <= 12);
    });
    dropped += before - atlas[name].length;
    if (!atlas[name].length) delete atlas[name];
  }
  return dropped;
}

// The nearest known place of any of the names: { name, x, y, z, n, seen, far } or null.
//   beyond  places nearer than this are left out: what is that close is seen, not remembered
//   layer   only places within this many blocks of the player's own height (an ore 40 blocks
//           down is not somewhere to walk to; the planner digs down first)
export function nearest(atlas, names, from, { beyond = 12, layer = 12, now = Date.now() } = {}) {
  let best = null;
  for (const name of names) for (const p of atlas?.[name] ?? []) {
    if (MOVES.has(name) && now - p.seen > CREATURE_AGE) continue;
    if (Math.abs(p.y - from.y) > layer) continue;
    const far = Math.hypot(p.x - from.x, p.z - from.z);
    if (far < beyond) continue;
    if (!best || far < best.far) best = { name, ...p, far: Math.round(far) };
  }
  return best;
}

// One line a kind, nearest to `from` first, for the session and for chat.
export function summary(atlas, from) {
  return Object.entries(atlas ?? {}).map(([name, places]) => {
    const near = [...places].sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
    return { name, places: places.length, nearest: { x: near.x, y: near.y, z: near.z }, far: Math.round(Math.hypot(near.x - from.x, near.z - from.z)) };
  }).sort((a, b) => a.far - b.far);
}
