// The name of the block at each of some places. args: { at: [[x, y, z], ...] }
export default async function whatIs({ bot, api }, { at = [] }) {
  return { ok: true, note: at.map(([x, y, z]) => `${x} ${y} ${z}: ${bot.blockAt(new api.Vec3(x, y, z))?.name ?? 'unknown'}`).join('; ') };
}
