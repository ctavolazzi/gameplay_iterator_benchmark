// Put what the player does not need on it into the storehouse (memory.store, set by
// skills/build.mjs when a building with chests in it is whole). In by the door, a chest at a
// time until the spares are gone or every chest is full, and out again with the door shut.
// What stays on the player: food, seeds, light, the bucket, the best tool of each kind, and a
// working amount of wood, coal, earth and stone. The rest goes in: the base's chest was for
// what a death must not take, and this is for everything gathered. What each chest holds is
// remembered. No args.
// (A chest carried is a chest about to be put down: the hall's four were made, put away in
// the storehouse by the next goal, and made again.)
// (Bread and seeds were kept whatever their number until the farm had run for a night: 135
// loaves and 796 seeds, and one place left in the pack. A stack of each stays; see UP_TO.)
// Seed is not stored at all: skills/tend.mjs throws down what is over two stacks. (The first
// trip under this rule put 471 seeds in a chest, which is clutter moved and not cleared.)
const ALWAYS = /^(torch|chest|bucket|water_bucket|.*_bed|shield|wheat_seeds|beetroot_seeds|carrot|potato|cooked_.*|apple|baked_potato)$/;
const NOT_WORTH_A_PLACE = /^(diorite|andesite|granite|tuff|gravel|leaf_litter|rotten_flesh|cobbled_deepslate|flint|egg|feather)$/;
const UP_TO = [[/_log$/, 16], [/_planks$/, 16], [/^stick$/, 16], [/^(coal|charcoal)$/, 16], [/^dirt$/, 32], [/^cobblestone$/, 64], [/^bread$/, 64]];

// [name, count] of what is carried beyond that.
export function surplusOf(items, best = [], diamondsSpare = 0) {
  const tools = new Set(best);
  const keptTool = {};
  const kept = UP_TO.map(() => 0);
  const out = {};
  let diamonds = diamondsSpare;
  for (const item of items) {
    if (ALWAYS.test(item.name) || NOT_WORTH_A_PLACE.test(item.name)) continue;
    let count = item.count;
    if (item.name === 'diamond') { count = Math.min(count, diamonds); diamonds -= count; }
    if (tools.has(item.name) && !keptTool[item.name]) { keptTool[item.name] = true; count -= 1; }
    const rule = UP_TO.findIndex(([pattern]) => pattern.test(item.name));
    if (rule >= 0) { const keep = Math.max(0, Math.min(count, UP_TO[rule][1] - kept[rule])); kept[rule] += keep; count -= keep; }
    if (count > 0) out[item.name] = (out[item.name] ?? 0) + count;
  }
  return Object.entries(out);
}

export default async function store({ bot, api, memory }) {
  const house = memory.store;
  if (!house) return { ok: false, note: 'there is no storehouse yet' };
  const vec = (cell) => new api.Vec3(cell.x, cell.y, cell.z);
  const surplus = () => surplusOf(bot.inventory.items(), ['_pickaxe', '_sword', '_axe', '_hoe', '_shovel'].map((ending) => api.bestOf(ending)?.name).filter(Boolean),
    Object.fromEntries(api.spares()).diamond ?? 0);
  const before = surplus();
  // Not ok, so that the brain leaves a little longer each time before asking again.
  if (!before.length) return { ok: false, note: 'nothing to put away' };
  const put = {};
  let full = 0, error = null;
  try {
    const went = await api.through(vec(house.door.cell), vec(house.door.outside), vec(house.door.inside));
    if (!went) return { ok: false, note: 'could not get in at the door of the storehouse' };
    for (const [index, at] of house.chests.entries()) {
      api.check();
      if (!surplus().length) break;
      const block = bot.blockAt(vec(at));
      if (block?.name !== 'chest') continue;
      const chest = await api.within(bot.openContainer(block), 8000, 'opening a chest');
      try {
        for (const [name, count] of surplus()) {
          api.check();
          try {
            await api.within(chest.deposit(bot.registry.itemsByName[name].id, null, count), 5000, `putting ${name} away`);
            put[name] = (put[name] ?? 0) + count;
          } catch {
            full += 1;   // this chest will take no more of it: the next one may
            break;
          }
        }
        house.holds ??= {};
        house.holds[index] = {};
        for (const item of chest.containerItems()) house.holds[index][item.name] = (house.holds[index][item.name] ?? 0) + item.count;
      } finally {
        chest.close();
        await api.sleep(250);
      }
    }
  } catch (failure) {
    error = failure.message;
  } finally {
    // Out again whatever happened: a player left inside has no way out but through the wall.
    try {
      const feet = bot.entity.position.floored();
      const o = house.origin;
      if (feet.x > o.x && feet.x < o.x + 4 && feet.z > o.z && feet.z < o.z + 4) await api.through(vec(house.door.cell), vec(house.door.inside), vec(house.door.outside));
    } catch { /* stopped on the way out */ }
    bot.clearControlStates();
  }
  const left = surplus().length;
  house.fullAt = left && full >= house.chests.length ? Date.now() : 0;
  const list = Object.entries(put).map(([name, n]) => `${n} ${name}`).join(', ');
  return { ok: Object.keys(put).length > 0, note: `put away ${list || 'nothing'}; ${left} kinds still carried as spares${house.fullAt ? ', and every chest is full' : ''}${error ? `; ended: ${error}` : ''}`.slice(0, 700) };
}
