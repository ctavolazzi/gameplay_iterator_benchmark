// Come back up: to the height of the remembered home, in legs of 10 blocks, then to home itself.
// No args. Turn 11: asked for in one piece from 60 blocks down with no pickaxe, it was thought
// about for 280 s and not one block was climbed. A leg of 10 blocks is a small thing to plan,
// and a leg that is climbed stays climbed when the time runs out.
export default async function surface({ bot, api, memory, note, skill }) {
  const home = memory.home;
  const top = home ? home.y : 66;
  const startY = bot.entity.position.y;
  let stalled = 0;
  let why = '';
  for (let leg = 0; leg < 12 && bot.entity.position.y < top - 2 && stalled < 2; leg++) {
    api.check();
    const from = bot.entity.position.y;
    const to = Math.min(top, Math.floor(from) + 10);
    await api.walk(new api.goals.GoalY(to), 100000, `climbing from ${Math.round(from)} to ${to}`, true).catch((error) => {
      if (/reflex|asked|died|out of time/.test(error.message)) throw error;
      note(error.message);
      why = `: ${error.message}`;
    });
    stalled = bot.entity.position.y - from < 3 ? stalled + 1 : 0;
    // A leg the pathfinder could not decide on is cut by hand, a step at a time (climb.mjs):
    // with empty hands it thinks about a climb through stone until its time is gone.
    if (stalled && bot.entity.position.y < top - 2) {
      const cut = await skill('climb', { toY: to, seconds: 150 });
      note(cut.note);
      if (bot.entity.position.y - from >= 3) stalled = 0;
    }
  }
  if (home && bot.entity.position.y >= top - 2) {
    await api.walk(new api.goals.GoalNear(home.x, home.y, home.z, 3), 60000, 'walking home').catch((error) => { api.check(); note(error.message); });
  }
  const climbed = Math.round(bot.entity.position.y - startY);
  const up = api.exposed() || bot.entity.position.y >= top - 2;
  const ok = up || climbed >= 8;
  return { ok, note: `climbed ${climbed} blocks to ${Math.round(bot.entity.position.y)}, ${api.exposed() ? 'under the sky' : 'still under ground'}${ok ? '' : why}` };
}
