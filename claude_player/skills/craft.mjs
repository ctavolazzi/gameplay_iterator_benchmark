// Craft an item. args: { item: 'planks' | 'stick' | 'crafting_table' | ..., times: 1 }
// 'planks' means planks of whatever wood is carried. A recipe that needs a crafting table
// uses one within 32 blocks; if none is there and one is carried, it is put down first.
export default async function craft({ api, note, skill }, { item, times = 1 }) {
  if (!item) return { ok: false, note: 'say which item' };
  let made = await api.craft(item, times);
  // No table near, or one that could not be reached: a carried table goes down right here.
  const tableNear = api.nearest('crafting_table', 32);
  if (!made.ok && api.carried().crafting_table && (/could not reach the crafting table/.test(made.error) || (/crafting table/.test(made.error) && !tableNear))) {
    const placed = await skill('place', { item: 'crafting_table' });
    note(`put the table down first: ${placed.note}`);
    if (placed.ok) made = await api.craft(item, times);
  }
  return made.ok
    ? { ok: true, note: `made ${Object.entries(made.made).map(([name, n]) => `${n} ${name}`).join(', ')}` }
    : { ok: false, note: made.error };
}
