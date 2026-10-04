// Come back up: to the remembered home if there is one, else to ground level. No args.
export default async function surface({ bot, api, memory }) {
  const home = memory.home;
  const goal = home ? new api.goals.GoalNear(home.x, home.y, home.z, 3) : new api.goals.GoalY(66);
  await api.walk(goal, 280000, 'climbing to the surface');
  return { ok: api.exposed(), note: `at ${Math.round(bot.entity.position.y)}, ${api.exposed() ? 'under the sky' : 'still under ground'}` };
}
