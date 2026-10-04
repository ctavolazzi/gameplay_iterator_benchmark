// Put the base's chest where it is not in the way. No args. Safe to run again.
// Turn 13: the chest was put down in the middle of the west wall. The game stands a waking
// player in the corner at the foot of the bed, and from that corner the only way to the
// doorway was through the cell the chest was in: the bed on one side, the chest on the other.
// It slept and stood in that corner for two game days and part of a third. The chest belongs
// on the north wall.
export default async function rearrangeBase({ bot, api, memory, note }) {
  const base = memory.base;
  if (!base) return { ok: false, note: 'no base remembered' };
  const c = new api.Vec3(base.x, base.y, base.z);
  const wrong = c.offset(-1, 0, 0);
  const right = c.offset(1, 0, -1);
  const take = async (cell) => {
    const block = bot.blockAt(cell);
    if (!block || block.boundingBox !== 'block') return null;
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    await api.within(bot.dig(block, true), 30000, `taking up the ${block.name}`);
    await api.sleep(500);
    await api.pickUp(5, 14);
    return block.name;
  };
  const moved = [];
  if (bot.blockAt(wrong)?.name === 'chest') moved.push(await take(wrong));
  await api.walk(new api.goals.GoalBlock(c.x, c.y, c.z), 8000, 'walking to the middle of the room').catch((error) => note(error.message));
  await api.pickUp(5, 14);
  const there = bot.blockAt(right);
  if (there && there.name !== 'air' && there.name !== 'chest') moved.push(await take(right));
  let placed = { ok: bot.blockAt(right)?.name === 'chest', at: api.round(right) };
  if (!placed.ok) placed = await api.placeAt('chest', right);
  if (placed.ok) (memory.baseHas ??= {}).chest = placed.at; else note(`chest: ${placed.error}`);
  return { ok: placed.ok, note: `took up ${moved.filter(Boolean).join(', ') || 'nothing'}; the chest is ${placed.ok ? `at ${right.x} ${right.y} ${right.z}` : 'not placed'}` };
}
