// Build a thing from a plan (plans.mjs): count what it takes, make it, place it stage by
// stage from where the plan says to stand, and read the world back against the plan.
// It does what is missing and nothing else, so a creeper's hole is mended by running it again.
// The ground is levelled first by skills/work.mjs (a 'build' job); here it is only checked.
// args: { plan: 'storehouse', x, y, z, seconds: 600 }   x, y, z: the plan's origin
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };

export default async function build({ bot, api, memory }, { plan: planName = 'storehouse', x, y, z, seconds = 600 }) {
  const { PLANS, planFaults, planMissing, standFor, ROLE } = await load('../plans.mjs');
  if (!PLANS[planName]) return { ok: false, note: `no plan called ${planName}` };
  if (![x, y, z].every(Number.isInteger)) return { ok: false, note: 'say where: x, y, z of the north-west corner, at the height a player stands' };
  const plan = PLANS[planName]({ x, y, z });
  const faults = planFaults(plan);
  if (faults.length) return { ok: false, note: `the plan has ${faults.length} faults and is not built: ${faults.slice(0, 3).map((f) => `${f.what} at ${f.cell.x} ${f.cell.y} ${f.cell.z}`).join('; ')}` };
  const { Vec3, goals } = api;
  const until = Date.now() + Math.max(20, Math.min(880, Number(seconds) || 600)) * 1000;
  const time = () => { api.check(); return Date.now() < until; };
  const vec = (cell) => new Vec3(cell.x, cell.y, cell.z);
  const name = (cell) => bot.blockAt(vec(cell))?.name ?? null;
  const solid = (cell) => bot.blockAt(vec(cell))?.boundingBox === 'block';
  const missing = () => planMissing(plan, name);
  const count = (pattern) => bot.inventory.items().filter((item) => pattern.test(item.name)).reduce((sum, item) => sum + item.count, 0);
  const trouble = [];
  const { w, d } = plan.size;

  // The ground under it and one step round it is whole, and nothing stands on it but the plan's own.
  const own = new Set(plan.stages.flatMap((stage) => stage.cells).map((c) => `${c.x},${c.y},${c.z}`));
  own.add(`${plan.door.cell.x},${plan.door.cell.y + 1},${plan.door.cell.z}`);
  let low = 0, high = 0;
  for (let cx = x - 1; cx <= x + w; cx++) for (let cz = z - 1; cz <= z + d; cz++) {
    if (!solid({ x: cx, y: y - 1, z: cz })) low += 1;
    for (let cy = y; cy <= y + plan.size.h - 1; cy++) if (solid({ x: cx, y: cy, z: cz }) && !own.has(`${cx},${cy},${cz}`)) high += 1;
  }
  if (low || high) return { ok: false, note: `the ground is not ready: ${low} blocks missing under it and ${high} standing in its way. Level it first (flatten, fill_land).`, left: missing().length };

  let placed = 0, error = null;
  const isInside = () => { const feet = bot.entity.position.floored(); return feet.x > x && feet.x < x + w - 1 && feet.z > z && feet.z < z + d - 1; };
  const doorIn = () => ROLE.door.test(name(plan.door.cell) ?? '');
  // In and out by the doorway: on foot through the door once there is one, and by the open gap before.
  async function goIn() {
    if (isInside()) return;
    if (doorIn()) await api.through(vec(plan.door.cell), vec(plan.door.outside), vec(plan.door.inside));
    else await api.walk(new goals.GoalBlock(plan.door.inside.x, plan.door.inside.y, plan.door.inside.z), 40000, 'walking in by the doorway');
    await api.settle();
  }
  async function goOut() {
    if (!isInside()) return;
    if (doorIn()) await api.through(vec(plan.door.cell), vec(plan.door.inside), vec(plan.door.outside));
    else await api.walk(new goals.GoalBlock(plan.door.outside.x, plan.door.outside.y, plan.door.outside.z), 40000, 'walking out by the doorway');
    await api.settle();
  }

  // One block into one cell, against whatever is solid under it or beside it. Sneaking, so that
  // a chest or a table it is placed against is not opened instead. The world says whether it went in.
  async function place(cell) {
    const at = vec(cell);
    const here = bot.blockAt(at);
    if (here && ROLE[cell.role].test(here.name)) return true;
    if (here && here.name !== 'air') {
      // Grass, a flower, or a block of earth that drifted in: out it comes. Anything made is left.
      if (/_planks$|_log$|chest|_door$|torch|_fence|_bed$|crafting_table|furnace/.test(here.name)) { trouble.push(`${here.name} is at ${cell.x} ${cell.y} ${cell.z} where ${cell.role} goes`); return false; }
      const tool = bot.pathfinder.bestHarvestTool(here);
      if (tool) await bot.equip(tool, 'hand');
      await api.within(bot.dig(here, true), 15000, `clearing ${here.name}`).catch(() => {});
      await api.sleep(150);
    }
    const item = bot.inventory.items().filter((it) => ROLE[cell.role].test(it.name) && it.name !== 'wall_torch').sort((a, b) => b.count - a.count)[0];
    if (!item) { trouble.push(`no ${cell.role} left`); return false; }
    await bot.equip(item, 'hand');
    bot.setControlState('sneak', true);
    try {
      for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const against = bot.blockAt(at.offset(dx, dy, dz));
        if (against?.boundingBox !== 'block') continue;
        await api.within(bot.placeBlock(against, new Vec3(-dx, -dy, -dz)), 5000, `placing ${cell.role}`).catch(() => {});
        await api.sleep(200);
        if (ROLE[cell.role].test(name(cell) ?? '')) return true;
      }
    } finally {
      bot.setControlState('sneak', false);
    }
    return false;
  }

  try {
    // 1 What it takes, counted against what is carried, and made at a table before anything is placed.
    const want = {};
    for (const cell of missing()) want[cell.role] = (want[cell.role] ?? 0) + 1;
    if (!Object.keys(want).length) {
      remember();
      return { ok: true, note: `the ${plan.name} at ${x} ${y} ${z} is whole`, whole: true, left: 0 };
    }
    const short = (role) => Math.max(0, (want[role] ?? 0) - count(ROLE[role]));
    if (short('planks') || short('chest') || short('door') || short('torch')) {
      const planks = short('planks') + 8 * short('chest') + (short('door') ? 6 : 0);
      const logs = bot.inventory.items().filter((item) => /_log$/.test(item.name)).sort((a, b) => b.count - a.count);
      const wood = logs[0]?.name.replace(/_log$/, '');
      const spare = count(/_log$/) - (want.log ?? 0);
      if (planks > 0 && (!wood || spare * 4 < planks)) return { ok: false, note: `not enough wood: ${planks} planks to make (${Math.ceil(planks / 4)} logs) besides ${want.log ?? 0} logs for posts, and ${count(/_log$/)} logs are carried`, left: missing().length };
      if (bot.inventory.emptySlotCount() < 4) return { ok: false, note: 'the pack has no room for what has to be made (4 places are needed)', left: missing().length };
      const made = async (item, times = 1) => { const got = await api.craft(item, times); if (!got.ok) trouble.push(`${item}: ${got.error}`); return got.ok; };
      if (planks > 0) await made(`${wood}_planks`, Math.ceil(planks / 4));
      if (short('chest')) await made('chest', short('chest'));
      if (short('door')) await made(`${wood}_door`);
      if (short('torch')) await made('torch');
      const still = ['planks', 'log', 'chest', 'door', 'torch'].filter((role) => short(role)).map((role) => `${short(role)} ${role}`);
      if (still.length) return { ok: false, note: `could not make everything: still short of ${still.join(', ')}${trouble.length ? ` (${trouble.slice(0, 3).join('; ')})` : ''}`, left: missing().length };
    }

    // 2 Stage by stage, each block from where the plan says to stand.
    for (const stage of plan.stages) {
      const todo = () => stage.cells.filter((cell) => !ROLE[cell.role].test(name(cell) ?? ''));
      if (!todo().length) continue;
      if (!time()) break;
      if (stage.from === 'inside') { await goIn(); await api.walk(new goals.GoalBlock(plan.spots.middle.x, plan.spots.middle.y, plan.spots.middle.z), 20000, 'walking to the middle of the floor'); }
      else await goOut();
      for (const cell of todo()) {
        if (!time()) break;
        try {
          if (stage.from !== 'inside') {
            const stand = standFor(plan, stage, cell);
            const feet = bot.entity.position;
            if (Math.abs(feet.x - stand.x - 0.5) > 0.6 || Math.abs(feet.z - stand.z - 0.5) > 0.6) {
              await api.walk(new goals.GoalBlock(stand.x, stand.y, stand.z), 30000, 'walking round the building');
              await api.settle();
            }
          }
          if (await place(cell)) placed += 1;
          else if (trouble.length > 10) break;
        } catch (failure) {
          api.check();
          trouble.push(`${failure.message} at ${cell.x} ${cell.y} ${cell.z}`);
        }
      }
      // A second go at what did not take the first time (a block whose neighbour came later).
      for (const cell of todo()) { if (!time()) break; try { if (await place(cell)) placed += 1; } catch { api.check(); } }
    }
    await goOut();
  } catch (failure) {
    error = failure.message;
  } finally {
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
  }

  // A building with chests in it is where things are kept from now on (skills/store.mjs).
  function remember() {
    if (!plan.chests?.length) return;
    memory.store = { plan: plan.name, origin: plan.origin, door: plan.door, chests: plan.chests, built: memory.store?.built ?? Date.now(), holds: memory.store?.holds ?? {} };
  }
  const left = missing();
  if (!left.length) remember();
  const by = {};
  for (const cell of left) by[cell.stage] = (by[cell.stage] ?? 0) + 1;
  const note = `placed ${placed}; ${left.length ? `${left.length} still missing (${Object.entries(by).map(([stage, n]) => `${stage} ${n}`).join(', ')})` : `the ${plan.name} at ${x} ${y} ${z} is whole`}, the player ${isInside() ? 'inside' : 'outside'}${trouble.length ? `. Trouble: ${[...new Set(trouble)].slice(0, 4).join('; ')}` : ''}${error ? `. Ended: ${error}` : ''}`;
  return { ok: placed > 0 || left.length === 0, note: note.slice(0, 800), whole: left.length === 0, left: left.length };
}
