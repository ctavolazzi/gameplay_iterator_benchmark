// Put a carried block on the ground close by. args: { item: 'crafting_table' }
export default async function place({ api }, { item }) {
  if (!item) return { ok: false, note: 'say which item' };
  const placed = await api.placeNear(item);
  return placed.ok
    ? { ok: true, note: `${placed.placed} at ${placed.at.x} ${placed.at.y} ${placed.at.z}` }
    : { ok: false, note: placed.error };
}
