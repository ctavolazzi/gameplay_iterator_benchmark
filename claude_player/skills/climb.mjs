// Climb by cutting a staircase, one step at a time, with no path asked for. For when the
// pathfinder cannot decide: with empty hands a block of stone costs it so much to dig that it
// looks down every cheap tunnel of the old mines first and runs out of time (after death 25
// the player stood at the bottom of the pit by its base for 5 minutes; turn 11 was the same).
// A step up takes three blocks at most: the one over the head, and the two it walks into.
// Nothing made is dug, nothing of the base, and nothing with water or lava against it.
// args: { toY, x, z }  toY: the height to stand at; x, z: which way to lean, if it matters
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEAR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MADE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|farmland|bedrock)$/;

export default async function climb({ bot, api }, { toY, x = null, z = null, seconds = 240 }) {
  if (!Number.isFinite(toY)) return { ok: false, note: 'say how high: toY' };
  const until = Date.now() + Math.max(20, Math.min(880, Number(seconds) || 240)) * 1000;
  const { Vec3 } = api;
  const startY = Math.floor(bot.entity.position.y);
  const block = (at) => bot.blockAt(at);
  const solid = (at) => block(at)?.boundingBox === 'block';
  const wet = (at) => NEAR.some(([dx, dy, dz]) => /water|lava/.test(block(at.offset(dx, dy, dz))?.name ?? ''));
  // A cell the player can be in after this: empty already, or a block that may be dug.
  const clearable = (at) => {
    const here = block(at);
    if (!here) return false;
    if (here.boundingBox !== 'block') return !/water|lava/.test(here.name);
    return here.diggable && !MADE.test(here.name) && !api.inBase(at) && !bot.claudeGuard?.(at) && !wet(at);
  };
  let dug = 0, steps = 0, misses = 0, why = '';
  let heading = null;
  const open = async (at) => {
    const here = block(at);
    if (!here || here.boundingBox !== 'block') return;
    const tool = bot.pathfinder.bestHarvestTool(here);
    if (tool) await bot.equip(tool, 'hand');
    await api.within(bot.dig(here, true), 30000, `cutting a step through ${here.name}`);
    dug += 1;
  };
  try {
    bot.pathfinder.setGoal(null);
    while (Math.floor(bot.entity.position.y) < toY && Date.now() < until) {
      api.check();
      await api.settle();
      const feet = bot.entity.position.floored();
      // The ways to step up from here: the block ahead to stand on is whole, and the two cells
      // over it and the one over the head can be opened. Toward the place asked for first, and
      // straight on before a turn, so that the stair is a stair and not a well.
      const ways = SIDES.map(([dx, dz]) => {
        const ahead = feet.offset(dx, 0, dz);
        const ok = solid(ahead) && !MADE.test(block(ahead)?.name ?? '') && clearable(ahead.offset(0, 1, 0)) && clearable(ahead.offset(0, 2, 0)) && clearable(feet.offset(0, 2, 0));
        const toward = x === null || z === null ? 0 : Math.hypot(ahead.x - x, ahead.z - z);
        const straight = heading && heading[0] === dx && heading[1] === dz ? -0.5 : 0;
        const work = [ahead.offset(0, 1, 0), ahead.offset(0, 2, 0), feet.offset(0, 2, 0)].filter(solid).length;
        return { dx, dz, ahead, ok, cost: toward + straight + work * 0.3 };
      }).filter((way) => way.ok).sort((a, b) => a.cost - b.cost);
      if (!ways.length) { why = 'no way to cut a step from here: every side is open below, wet, or not to be dug'; break; }
      const way = ways[0];
      await open(feet.offset(0, 2, 0));
      await open(way.ahead.offset(0, 2, 0));
      await open(way.ahead.offset(0, 1, 0));
      // Up and on to it: face it, forward and jump, until the feet are a block higher.
      await bot.lookAt(way.ahead.offset(0.5, 2.2, 0.5), true);
      // Both keys held until the feet are on the higher block: standing on it, not passing it
      // at the top of a jump. (The first version let go at the top of the jump and dropped
      // back, 250 times in 200 s.)
      // Up to the face of the step on foot first, in line with it: a jump begun 0.7 of a block
      // back, or from the corner of the cell, comes down where it started (in the air the body
      // gathers almost no speed). Then the jump.
      const centre = way.ahead.offset(0.5, 0, 0.5);
      const off = () => (way.dx ? Math.abs(bot.entity.position.z - centre.z) : Math.abs(bot.entity.position.x - centre.x));
      const gap = () => (way.dx ? Math.abs(bot.entity.position.x - centre.x) : Math.abs(bot.entity.position.z - centre.z));
      if (off() > 0.2) {
        // Sideways into line with the step, by walking toward the middle of the cell stood in.
        await bot.lookAt(feet.offset(0.5, 1.6, 0.5), true);
        bot.setControlState('forward', true);
        for (let i = 0; i < 12 && off() > 0.15; i++) await api.sleep(50);
        bot.setControlState('forward', false);
        await api.sleep(100);
        await bot.lookAt(way.ahead.offset(0.5, 2.2, 0.5), true);
      }
      bot.setControlState('forward', true);
      for (let i = 0; i < 16 && gap() > 0.85; i++) await api.sleep(50);
      bot.setControlState('jump', true);
      const landed = () => bot.entity.onGround && Math.floor(bot.entity.position.y) > feet.y
        && Math.abs(bot.entity.position.x - way.ahead.x - 0.5) < 0.45 && Math.abs(bot.entity.position.z - way.ahead.z - 0.5) < 0.45;
      for (let i = 0; i < 50 && !landed(); i++) {
        if (i % 10 === 5) await bot.lookAt(way.ahead.offset(0.5, 2.2, 0.5), true);
        await api.sleep(60);
      }
      bot.clearControlStates();
      await api.settle();
      if (Math.floor(bot.entity.position.y) > feet.y) { steps += 1; heading = [way.dx, way.dz]; misses = 0; }
      else { heading = null; why = 'a step was cut and not climbed'; if (++misses > 8) break; }
    }
  } catch (failure) {
    bot.clearControlStates();
    try { bot.stopDigging(); } catch { /* not digging */ }
    if (/reflex|asked|died|out of time/.test(failure.message)) throw failure;
    why = failure.message;
  } finally {
    bot.clearControlStates();
  }
  const now = Math.floor(bot.entity.position.y);
  return { ok: now >= toY || steps >= 3, note: `cut ${steps} steps (${dug} blocks) from ${startY} to ${now}${now >= toY ? '' : `, short of ${toY}${why ? `: ${why}` : ''}`}` };
}
