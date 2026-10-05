// Take things out of the storehouse (memory.store): the other half of store.mjs. "A banked
// thing is only safe if it can be taken out again" (NOTES.md, turn 18). In by the door, each
// chest opened until what was asked for is carried, out again with the door shut.
// args: { items: { iron_pickaxe: 1, coal: 8, oak_log: 12 } }   A name ending in "_log" or
// "_planks" with no wood in front ("log", "planks") means any kind.
export default async function take({ bot, api, memory }, { items = {} } = {}) {
  const house = memory.store;
  if (!house) return { ok: false, note: 'there is no storehouse yet' };
  const want = Object.entries(items).filter(([, n]) => Number(n) > 0).map(([name, n]) => ({ name, left: Math.floor(Number(n)), match: name === 'log' ? /_log$/ : name === 'planks' ? /_planks$/ : new RegExp(`^${name}$`) }));
  if (!want.length) return { ok: false, note: 'say what: items' };
  if (bot.inventory.emptySlotCount() < want.length) return { ok: false, note: `the pack has ${bot.inventory.emptySlotCount()} places free and ${want.length} kinds were asked for` };
  const vec = (cell) => new api.Vec3(cell.x, cell.y, cell.z);
  const got = {};
  let error = null;
  try {
    const went = await api.through(vec(house.door.cell), vec(house.door.outside), vec(house.door.inside));
    if (!went) return { ok: false, note: 'could not get in at the door of the storehouse' };
    for (const [index, at] of house.chests.entries()) {
      api.check();
      if (want.every((w) => w.left <= 0)) break;
      const block = bot.blockAt(vec(at));
      if (block?.name !== 'chest') continue;
      const chest = await api.within(bot.openContainer(block), 8000, 'opening a chest');
      try {
        for (const w of want) {
          for (const item of chest.containerItems().filter((it) => w.match.test(it.name))) {
            if (w.left <= 0) break;
            const n = Math.min(w.left, item.count);
            try {
              await api.within(chest.withdraw(item.type, null, n), 5000, `taking ${item.name}`);
              w.left -= n;
              got[item.name] = (got[item.name] ?? 0) + n;
            } catch { break; }
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
    try {
      const feet = bot.entity.position.floored();
      const o = house.origin;
      if (feet.x > o.x && feet.x < o.x + 4 && feet.z > o.z && feet.z < o.z + 4) await api.through(vec(house.door.cell), vec(house.door.inside), vec(house.door.outside));
    } catch { /* stopped on the way out */ }
    bot.clearControlStates();
  }
  const short = want.filter((w) => w.left > 0).map((w) => `${w.left} ${w.name}`);
  const list = Object.entries(got).map(([name, n]) => `${n} ${name}`).join(', ');
  return { ok: Object.keys(got).length > 0 && !short.length, note: `took ${list || 'nothing'}${short.length ? `; not there: ${short.join(', ')}` : ''}${error ? `; ended: ${error}` : ''}`, got, short: short.length };
}
