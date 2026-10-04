// Walk to a place, in legs of 32 blocks so that a long way is never one long think.
// args: { x, z, y (optional), range: 3 }
export default async function goTo({ bot, api }, { x, y, z, range = 3 }) {
  if (typeof x !== 'number' || typeof z !== 'number') return { ok: false, note: 'say where: x and z' };
  for (let leg = 0; leg < 40; leg++) {
    const here = bot.entity.position.clone();
    const far = Math.hypot(x - here.x, z - here.z);
    if (far <= 40) break;
    const k = 32 / far;
    await api.walk(new api.goals.GoalNearXZ(here.x + (x - here.x) * k, here.z + (z - here.z) * k, 4), 45000, 'walking a leg of the way')
      .catch((error) => { if (/reflex|asked|died|out of time/.test(error.message)) throw error; });
    if (bot.entity.position.distanceTo(here) < 4) return { ok: false, note: `stuck ${Math.round(far)} blocks short` };
  }
  const goal = typeof y === 'number' ? new api.goals.GoalNear(x, y, z, range) : new api.goals.GoalNearXZ(x, z, range);
  await api.walk(goal, 90000, 'walking the last stretch');
  const end = bot.entity.position;
  return { ok: true, note: `at ${Math.round(end.x)} ${Math.round(end.y)} ${Math.round(end.z)}` };
}
