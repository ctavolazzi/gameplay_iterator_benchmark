// Go back to where the player died and pick up what is lying there, then get out again.
// args: { where: { x, y, z } }
// Turn 4: three times it fetched its things from a flooded cave and drowned on the spot,
// because the fetching ended under water with nothing to say "now leave". So this skill
// remembers the last place it stood with a full breath, goes back there whenever breath
// runs short, and ends there.
export default async function recover({ bot, api, note }, { where }) {
  if (!where) return { ok: false, note: 'say where' };
  const before = api.carried();
  let air = bot.entity.position.clone();
  const wet = () => /water|bubble_column/.test(bot.blockAt(bot.entity.position.offset(0, 1.6, 0))?.name ?? '');
  const breath = () => (wet() ? bot.oxygenLevel ?? 20 : 20);
  const crumbs = setInterval(() => { if (!wet() && !api.wetAt(bot.entity.position) && bot.entity.onGround) air = bot.entity.position.clone(); }, 200);
  const toAir = async () => {
    await api.walk(new api.goals.GoalNear(air.x, air.y, air.z, 1), 15000, 'getting back to air').catch(() => {});
    for (let waited = 0; waited < 40 && breath() < 18; waited++) await api.sleep(250);
  };
  try {
    const far = bot.entity.position.distanceTo(new api.Vec3(where.x, where.y, where.z));
    // Stop short of the place itself: what is lying there is picked up item by item.
    await api.walk(new api.goals.GoalNear(where.x, where.y, where.z, 6), Math.min(100000, 20000 + far * 2000), 'walking back to where it died').catch((error) => { api.check(); note(error.message); });
    for (let trip = 0; trip < 14; trip++) {
      api.check();
      if (breath() < 14) { await toAir(); continue; }
      const here = bot.entity.position;
      const drop = bot.nearestEntity((e) => e.name === 'item' && e.position.distanceTo(new api.Vec3(where.x, where.y, where.z)) < 12);
      if (!drop) break;
      await api.walk(new api.goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0), 5000, 'reaching a dropped item').catch(() => {});
      await api.sleep(200);
      if (breath() < 14 || bot.entity.position.distanceTo(here) < 0.3) await toAir();
    }
  } finally {
    clearInterval(crumbs);
    if (breath() < 20) await toAir().catch(() => {});
  }
  const now = api.carried();
  const got = Object.keys(now).filter((name) => now[name] > (before[name] ?? 0));
  return got.length ? { ok: true, note: `picked up ${got.join(', ')}; breath ${breath()}` } : { ok: false, note: 'nothing was picked up' };
}
