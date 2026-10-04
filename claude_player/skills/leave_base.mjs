// Open the base's doorway from the inside, whatever it was closed with, and step out. No args.
// Turn 8: the doorway had been closed with planks before bed, planks are on the list of
// built things that are never dug through, and the player was shut in its own base for 14
// minutes: "No path to the goal!", 5 times, and 5 pointless reconnects.
export default async function leaveBase({ bot, api, memory }) {
  const base = memory.base;
  if (!base) return { ok: false, note: 'no base remembered' };
  const c = new api.Vec3(base.x, base.y, base.z);
  await api.walk(new api.goals.GoalBlock(c.x + 1, c.y, c.z), 8000, 'walking to the doorway').catch(() => {});
  let opened = 0;
  for (const cell of [c.offset(2, 1, 0), c.offset(2, 0, 0)]) {
    const block = bot.blockAt(cell);
    if (!block || block.boundingBox !== 'block') continue;
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    await api.within(bot.dig(block, true), 20000, 'opening the doorway');
    opened += 1;
  }
  await api.walk(new api.goals.GoalBlock(c.x + 2, c.y, c.z), 8000, 'stepping into the doorway').catch(() => {});
  const out = Math.round(bot.entity.position.x) >= c.x + 2;
  return { ok: out || opened > 0, note: `opened ${opened} blocks of the doorway; now at ${Math.round(bot.entity.position.x)} ${Math.round(bot.entity.position.y)} ${Math.round(bot.entity.position.z)}` };
}
