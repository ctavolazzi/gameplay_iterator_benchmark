// Put a carried block on the ground close by, and remember where. args: { item: 'crafting_table' }
export default async function place({ api, memory }, { item }) {
  if (!item) return { ok: false, note: 'say which item' };
  const placed = await api.placeNear(item);
  if (!placed.ok) return { ok: false, note: placed.error };
  memory.places ??= {};
  memory.places[placed.placed] = placed.at;
  // Remembered as this player's own, so that it can be taken along again and nobody else's is.
  if (/^(crafting_table|furnace)$/.test(placed.placed)) (memory.own ??= []).push({ name: placed.placed, at: placed.at });
  if (api.exposed()) memory.home ??= placed.at;
  return { ok: true, note: `${placed.placed} at ${placed.at.x} ${placed.at.y} ${placed.at.z}` };
}
