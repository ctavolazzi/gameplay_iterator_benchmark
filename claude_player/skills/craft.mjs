// Craft an item. args: { item: 'planks' | 'stick' | 'crafting_table' | ..., times: 1 }
// 'planks' means planks of whatever wood is carried. A recipe that needs a crafting table
// uses one close by; if that one cannot be reached and one is carried, it is put down first.
export default async function craft({ api, note, skill }, { item, times = 1 }) {
  if (!item) return { ok: false, note: 'say which item' };
  let made = await api.craft(item, times);
  if (!made.ok && /crafting table/.test(made.error) && api.carried().crafting_table && !api.tableNear(24)) {
    const placed = await skill('place', { item: 'crafting_table' });
    note(`put the table down first: ${placed.note}`);
    if (placed.ok) made = await api.craft(item, times);
  }
  return made.ok
    ? { ok: true, note: `made ${Object.entries(made.made).map(([name, n]) => `${n} ${name}`).join(', ')}` }
    : { ok: false, note: made.error };
}
