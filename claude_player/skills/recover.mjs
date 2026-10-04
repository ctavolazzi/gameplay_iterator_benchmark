// Go back to where the player died and pick up what is lying there. args: { where: { x, y, z } }
export default async function recover({ bot, api }, { where }) {
  if (!where) return { ok: false, note: 'say where' };
  const before = api.carried();
  const far = bot.entity.position.distanceTo(new api.Vec3(where.x, where.y, where.z));
  await api.walk(new api.goals.GoalNear(where.x, where.y, where.z, 1), Math.min(100000, 20000 + far * 2000), 'walking back to where it died');
  await api.pickUp(10, 12);
  const now = api.carried();
  const got = Object.keys(now).filter((name) => now[name] > (before[name] ?? 0));
  return got.length ? { ok: true, note: `picked up ${got.join(', ')}` } : { ok: false, note: 'nothing was lying there' };
}
