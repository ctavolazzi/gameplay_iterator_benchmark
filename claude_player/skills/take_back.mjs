// Break a crafting table or furnace the player put down itself and carry it along.
// args: { item: 'crafting_table' | 'furnace', at: { x, y, z } }
// CT's note, 2026-10-03: "you can also totally destroy crafting tables and furnaces and take
// them with you after you set them down". Only ones this player placed, and never the base's.
export default async function takeBack({ bot, api, memory }, { item, at }) {
  if (!item || !at) return { ok: false, note: 'say which item and where' };
  const spot = new api.Vec3(at.x, at.y, at.z);
  const forget = () => { memory.own = (memory.own ?? []).filter((o) => !(o.at.x === at.x && o.at.y === at.y && o.at.z === at.z)); };
  if (api.inBase(spot)) { forget(); return { ok: false, note: 'that one belongs to the base' }; }
  if (bot.blockAt(spot)?.name !== item) { forget(); return { ok: false, note: `no ${item} there any more` }; }
  const before = api.carried()[item] ?? 0;
  await api.digAt(spot, item);
  forget();
  for (let waited = 0; waited < 5 && (api.carried()[item] ?? 0) <= before; waited++) { await api.pickUp(5, 1); await api.sleep(300); }
  const got = (api.carried()[item] ?? 0) > before;
  return got ? { ok: true, note: `carrying the ${item} again` } : { ok: false, note: `broke the ${item} and did not pick it up` };
}
