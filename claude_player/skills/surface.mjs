// Come back up: to the height of the remembered home, in legs of 10 blocks, then to home itself.
// No args. Turn 11: asked for in one piece from 60 blocks down with no pickaxe, it was thought
// about for 280 s and not one block was climbed. A leg of 10 blocks is a small thing to plan,
// and a leg that is climbed stays climbed when the time runs out.
export default async function surface({ bot, api, memory, note, skill }) {
  const home = memory.home;
  const top = home ? home.y : 66;
  const startY = bot.entity.position.y;
  const wasUnder = !api.exposed();
  let stalled = 0;
  let why = '';
  // With a hall, the way up from the mine is its hatch (the one open column under its far
  // corner): into the hall beside it, and on up the stairs. Everything else of the hall is
  // guarded, and a climb that came out on the lawn left a hole there every time.
  const hall = memory.hall?.whole && memory.hall.c ? memory.hall : null;
  const here = bot.entity.position;
  if (hall && here.y < hall.c.y - 1 && Math.hypot(here.x - hall.c.x, here.z - hall.c.z) < 90) {
    const into = [hall.c.x + 8, hall.c.y, hall.c.z + 3];
    await api.walk(new api.goals.GoalBlock(into[0], into[1], into[2]), 200000, 'climbing to the hatch in the hall', true).catch((error) => {
      if (/reflex|asked|died|out of time/.test(error.message)) throw error;
      note(`the hatch: ${error.message}`);
    });
    const now = bot.entity.position.floored();
    if (now.x === into[0] && now.z === into[2] && now.y === into[1]) note(`up through the hatch into the hall from ${Math.round(startY)}`);
  }
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
  // The hole it came up by is closed behind it, where the ground is kept level (round the
  // farm): each climb out of the mine used to leave one more in the lawn. Not over the bedroom,
  // whose roof has a way in, and not the stairs.
  const field = memory.farmField;
  const out = bot.entity.position.floored();
  if (wasUnder && api.exposed() && field && Math.abs(out.y - field.level - 1) <= 1
    && Math.hypot(out.x - field.x - 10, out.z - field.z - 5) < 45 && !(out.x > field.x && out.x < field.x + 20 && out.z > field.z && out.z < field.z + 10)) {
    const c = memory.base;
    const skip = c ? [[c.x - 3, c.z - 3, c.x + 3, c.z + 3], [c.x + 6, c.z + 4, c.x + 6, c.z + 5 + (memory.hall?.steps ?? 8)]] : [];
    await api.walk(new api.goals.GoalNear(out.x + 2, out.y, out.z + 2, 1), 10000, 'stepping away from the hole').catch(() => api.check());
    const closed = await skill('fill_land', { x1: out.x - 1, z1: out.z - 1, x2: out.x + 1, z2: out.z + 1, level: field.level, depth: 6, anyTop: true, seconds: 30, skip });
    note(`the hole it came up by: ${closed.note}`);
  }
  const climbed = Math.round(bot.entity.position.y - startY);
  const up = api.exposed() || bot.entity.position.y >= top - 2;
  const ok = up || climbed >= 8;
  return { ok, note: `climbed ${climbed} blocks to ${Math.round(bot.entity.position.y)}, ${api.exposed() ? 'under the sky' : 'still under ground'}${ok ? '' : why}` };
}
