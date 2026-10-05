// Build the farm on ground that flatten.mjs and fill_land.mjs have made level. CT, 2026-10-04:
// "get started building a farm for me ... search online for minecraft farm ideas". What was
// read says the same thing everywhere: one block of water keeps the earth wet for 4 blocks
// each way, so a 9 by 9 plot round one water block is the most field for the least water;
// fence it (what walks on tilled earth turns it back to dirt) and light it (crops grow in the
// dark under a torch, and nothing spawns in the light).
//
// The plan, 21 by 11, from its north-west corner (x, z). level is the block the crops stand on.
//
//   F F F F F F F F F F F F F F F F F F F F F      F  fence, one block high
//   F . . . . . . . . . t . . . . . . . . . F      .  tilled earth
//   F . . . . . . . . . p . . . . . . . . . F      W  water, in the middle of each plot
//   F . . . . . . . . . p . . . . . . . . . F      p  the path between the plots, left as it is
//   F . . . . . . . . . p . . . . . . . . . F      t  a torch on the path
//   F . . . . W . . . . t . . . . W . . . . F      G  the gate, in the middle of the south side
//   F . . . . . . . . . p . . . . . . . . . F
//   F . . . . . . . . . p . . . . . . . . . F
//   F . . . . . . . . . p . . . . . . . . . F
//   F . . . . . . . . . t . . . . . . . . . F
//   F F F F F F F F F F G F F F F F F F F F F
//
// It does what is missing and nothing else, so it is run again until it says nothing is left.
// args: { x, z, level: 65, seconds: 600, waterFrom: { x, y, z }, only: 'water' | 'till' | 'light' | 'fence' }
const SEED = /^(wheat_seeds|carrot|potato|beetroot_seeds)$/;
const CROP = /^(wheat|carrots|potatoes|beetroots)$/;

export function farmPlan(x, z, level) {
  const ring = [], plots = [], path = [];
  for (let dx = 0; dx <= 20; dx++) for (let dz = 0; dz <= 10; dz++) {
    if (dx === 0 || dx === 20 || dz === 0 || dz === 10) ring.push([x + dx, level + 1, z + dz]);
    else if (dx === 10) path.push([x + dx, level, z + dz]);
    else plots.push([x + dx, level, z + dz]);
  }
  const waters = [[x + 5, level, z + 5], [x + 15, level, z + 5]];
  const wet = new Set(waters.map(String));
  const gate = [x + 10, level + 1, z + 10];
  return { level, waters, gate, path,
    ring: ring.filter((cell) => String(cell) !== String(gate)),
    plots: plots.filter((cell) => !wet.has(String(cell))),
    torches: [[x + 10, level + 1, z + 1], [x + 10, level + 1, z + 5], [x + 10, level + 1, z + 9]],
    outside: [x + 10, level + 1, z + 11],
    // A crafting table by the gate: the fence is made there, and so is whatever the farm needs later.
    bench: [x + 12, level + 1, z + 12] };
}

// Whether the fence and its gate are all there: a closed field is entered by its gate only.
export function ringClosed(bot, x, z, level) {
  const plan = farmPlan(x, z, level);
  const spot = bot.entity.position.floored();
  const nameAt = ([cx, cy, cz]) => bot.blockAt(spot.offset(cx - spot.x, cy - spot.y, cz - spot.z))?.name ?? '';
  return /_fence_gate$/.test(nameAt(plan.gate)) && plan.ring.every((cell) => /_fence$/.test(nameAt(cell)));
}

export default async function buildFarm({ bot, api }, { x, z, level = 65, seconds = 600, waterFrom = null, only = null }) {
  if (![x, z, level].every(Number.isInteger)) return { ok: false, note: 'say the north-west corner and the level: x, z, level' };
  const { Vec3, goals } = api;
  const plan = farmPlan(x, z, level);
  const until = Date.now() + Math.max(10, Math.min(880, Number(seconds) || 600)) * 1000;
  const time = () => { api.check(); return Date.now() < until; };
  const at = ([cx, cy, cz]) => new Vec3(cx, cy, cz);
  const name = (cell) => bot.blockAt(at(cell))?.name ?? null;
  const solid = (cell) => bot.blockAt(at(cell))?.boundingBox === 'block';
  const up = ([cx, cy, cz]) => [cx, cy + 1, cz];
  const did = { water: 0, tilled: 0, planted: 0, earth: 0, torches: 0, fences: 0, gate: 0 };
  const trouble = [];
  const wants = (stage) => !only || only === stage;
  const near = async (cell, range = 2) => {
    if (at(cell).offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.62, 0)) > 3.6) {
      await api.walk(new goals.GoalNear(cell[0], level + 1, cell[2], range), 25000, 'walking to the farm');
      await api.settle();
    }
  };
  // Stand on a block beside a cell and never in it.
  const beside = async (cell) => {
    const feet = bot.entity.position.floored();
    if (feet.x !== cell[0] || feet.z !== cell[2]) return;
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cell[0] + dx, level, cell[2] + dz]).find(solid);
    if (side) await api.walk(new goals.GoalBlock(side[0], level + 1, side[2]), 8000, 'stepping aside');
    await api.settle();
  };
  const clearPlant = async (cell) => {
    const block = bot.blockAt(at(cell));
    if (block && block.name !== 'air' && block.boundingBox === 'empty' && !CROP.test(block.name) && !/torch|water/.test(block.name)) {
      await api.within(bot.dig(block, true), 5000, `clearing ${block.name}`).catch(() => {});
      await api.sleep(150);
    }
  };

  // What is not level: the plan stands on whole ground with nothing on it.
  const high = [], low = [];
  for (let dx = 0; dx <= 20; dx++) for (let dz = 0; dz <= 10; dz++) {
    const ground = [x + dx, level, z + dz];
    if (!solid(ground) && name(ground) !== 'water') low.push(ground);
    const over = name(up(ground)) ?? '';
    if (solid(up(ground)) && !/_fence$|_fence_gate$/.test(over)) high.push(up(ground));
  }
  // A hole in a field that is already fenced is mended from inside, in by the gate (the night
  // shelter dug in the path on 2026-10-04 was three such blocks).
  let mended = 0;
  if (!high.length && low.length && low.length <= 12 && ringClosed(bot, x, z, level)) {
    try {
      await enter();
      for (const ground of low) {
        let floor = level - 1;
        while (floor > level - 8 && !solid([ground[0], floor, ground[2]])) floor -= 1;
        for (let y = floor + 1; y <= level; y++) {
          const cell = [ground[0], y, ground[2]];
          const earth = api.find(/^dirt$/);
          if (!earth) break;
          await near(cell);
          await beside(cell);
          await bot.equip(earth, 'hand');
          for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
            const against = bot.blockAt(at(cell).offset(dx, dy, dz));
            if (against?.boundingBox !== 'block') continue;
            await api.within(bot.placeBlock(against, new Vec3(-dx, -dy, -dz)), 4000, 'mending the ground').catch(() => {});
            await api.sleep(150);
            if (solid(cell)) { mended += 1; break; }
          }
        }
      }
    } catch (failure) {
      api.check();
    }
    for (let i = low.length - 1; i >= 0; i--) if (solid(low[i])) low.splice(i, 1);
  }
  if (high.length || low.length) {
    bot.clearControlStates();
    return { ok: mended > 0, note: `${mended ? `mended ${mended} blocks; ` : ''}the ground is not level yet: ${high.length} blocks stand above ${level} and ${low.length} are missing at ${level} (first ${JSON.stringify(high[0] ?? low[0])}). Run flatten and fill_land first.` };
  }

  // In and out by the gate, on foot and by hand. Left to the pathfinder, a fenced field is
  // got into by putting a block of earth down by the fence and hopping over on to the tilled
  // ground. Its own option for opening gates (canOpenDoors) ended the whole process at 20:03 on
  // 2026-10-04: after opening the gate its tick reads a value it has just emptied.
  // (Functions, not constants: the mending above runs before this line is reached.)
  function gateIn() { return /_fence_gate$/.test(name(plan.gate) ?? ''); }
  function gateOpen() { const gate = bot.blockAt(at(plan.gate)); return !!gate && /_fence_gate$/.test(gate.name) && String(gate.getProperties().open) === 'true'; }
  function isInside() { const feet = bot.entity.position.floored(); return feet.x > x && feet.x < x + 20 && feet.z > z && feet.z < z + 10; }
  function closed() { return gateIn() && plan.ring.every((cell) => /_fence$/.test(name(cell) ?? '')); }
  async function setGate(open) {
    if (!gateIn() || gateOpen() === open) return;
    await bot.lookAt(at(plan.gate).offset(0.5, 0.5, 0.5), true);
    await api.within(bot.activateBlock(bot.blockAt(at(plan.gate))), 4000, open ? 'opening the gate' : 'shutting the gate').catch(() => {});
    await api.sleep(300);
  }
  // Straight through the gateway from one side to the cell on the other, and the gate shut behind.
  async function through(from, to) {
    await api.walk(new goals.GoalBlock(from[0], from[1], from[2]), 40000, 'walking to the gate');
    await api.settle();
    await setGate(true);
    await bot.lookAt(new Vec3(to[0] + 0.5, to[1] + 1.2, to[2] + 0.5), true);
    bot.setControlState('forward', true);
    for (let i = 0; i < 30; i++) {
      await api.sleep(100);
      const feet = bot.entity.position;
      if (Math.abs(feet.x - to[0] - 0.5) < 0.4 && Math.abs(feet.z - to[2] - 0.5) < 0.4) break;
    }
    bot.clearControlStates();
    await api.sleep(150);
    const feet = bot.entity.position.floored();
    if (!(feet.x === plan.gate[0] && feet.z === plan.gate[2])) await setGate(false);
  }
  async function enter() { if (closed() && !isInside()) await through(plan.outside, [plan.gate[0], level + 1, plan.gate[2] - 1]); }
  async function leave() {
    if (closed() && isInside()) await through([plan.gate[0], level + 1, plan.gate[2] - 1], plan.outside);
    const feet = bot.entity.position.floored();
    if (!(feet.x === plan.gate[0] && feet.z === plan.gate[2])) await setGate(false);
  }

  let error = null;
  try {
    // 1 Water. The bucket is filled at waterFrom, so that the second plot's water is not
    // taken out of the first plot.
    if (wants('water')) for (const cell of plan.waters) {
      if (!time()) break;
      if (name(cell) === 'water') continue;
      if (!api.carried().water_bucket) {
        // With no place given, the nearest still water under the open sky that is not the farm's own.
        const feet = bot.entity.position;
        const from = waterFrom ?? bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 64, count: 400 })
          .filter((p) => !(p.x >= x && p.x <= x + 20 && p.z >= z && p.z <= z + 10) && bot.blockAt(p.offset(0, 1, 0))?.name === 'air'
            && Number(bot.blockAt(p)?.getProperties?.().level ?? 1) === 0)
          .sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0] ?? null;
        if (from) await api.walk(new goals.GoalNear(from.x, from.y, from.z, 3), 90000, 'walking to the water');
        const filled = await api.fillBucket('water');
        if (!filled.ok) { trouble.push(`no water: ${filled.error}`); break; }
        if (plan.waters.some((w) => w[0] === filled.at.x && w[2] === filled.at.z)) trouble.push('the bucket was filled from the farm itself');
      }
      const stand = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => [cell[0] + dx, level, cell[2] + dz]).find(solid);
      await api.walk(new goals.GoalBlock(stand[0], level + 1, stand[2]), 90000, 'walking back with the water');
      await api.settle();
      const below = [cell[0], level - 1, cell[2]];
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [cell[0] + dx, level, cell[2] + dz]);
      if (!sides.every(solid)) { trouble.push(`the water at ${cell} would run out: a side is open`); continue; }
      if (solid(cell)) {
        const block = bot.blockAt(at(cell));
        const tool = bot.pathfinder.bestHarvestTool(block);
        if (tool) await bot.equip(tool, 'hand');
        await api.within(bot.dig(block, true), 15000, 'digging the water hole');
        await api.sleep(300);
      }
      if (!solid(below)) { trouble.push(`nothing under the water hole at ${cell}`); continue; }
      await bot.equip(api.find(/^water_bucket$/), 'hand');
      await bot.lookAt(at(below).offset(0.5, 1, 0.5), true);
      await api.sleep(250);
      bot.activateItem();
      await api.sleep(800);
      bot.deactivateItem();
      await api.sleep(400);
      if (name(cell) === 'water') did.water += 1;
      else trouble.push(`poured at ${cell} and the block is ${name(cell)}`);
    }

    // 2 Till, nearest row first, and plant whatever seed is carried.
    if (wants('till')) {
      const rows = [...plan.plots].sort((a, b) => a[2] - b[2] || (a[2] % 2 ? b[0] - a[0] : a[0] - b[0]));
      const wanted = (cell) => !(name(cell) === 'farmland' && (CROP.test(name(up(cell)) ?? '') || !api.find(SEED)));
      // Once the fence is closed the field is worked from inside it, in by the gate.
      if (rows.some(wanted)) await enter();
      for (const cell of rows) {
        if (!time()) break;
        const crop = name(up(cell));
        if (name(cell) === 'farmland' && (CROP.test(crop ?? '') || !api.find(SEED))) continue;
        const hoe = api.bestOf('_hoe');
        if (!hoe) { trouble.push('no hoe'); break; }
        try {
          await near(cell);
          await beside(cell);
          await clearPlant(up(cell));
          if (!/^(grass_block|dirt|farmland|dirt_path|coarse_dirt|rooted_dirt)$/.test(name(cell) ?? '')) {
            // Rock where the hill was cut: out it comes, and earth goes in.
            const earth = api.find(/^dirt$/);
            if (!earth) { trouble.push(`${name(cell)} at ${cell} and no dirt to put there`); continue; }
            const block = bot.blockAt(at(cell));
            const tool = bot.pathfinder.bestHarvestTool(block);
            if (tool) await bot.equip(tool, 'hand');
            await api.within(bot.dig(block, true), 20000, `digging out ${block.name}`);
            await api.sleep(200);
            await bot.equip(earth, 'hand');
            await api.within(bot.placeBlock(bot.blockAt(at(cell).offset(0, -1, 0)), new Vec3(0, 1, 0)), 4000, 'putting earth in').catch(() => {});
            await api.sleep(200);
            if (name(cell) !== 'dirt') { trouble.push(`could not put earth at ${cell}`); continue; }
            did.earth += 1;
          }
          if (name(cell) !== 'farmland') {
            await bot.equip(hoe, 'hand');
            await bot.lookAt(at(cell).offset(0.5, 1, 0.5), true);
            await api.within(bot.activateBlock(bot.blockAt(at(cell))), 4000, 'tilling');
            await api.sleep(250);
            if (name(cell) !== 'farmland') { trouble.push(`tilled ${cell} and it is still ${name(cell)}`); continue; }
            did.tilled += 1;
          }
          const seed = api.find(SEED);
          if (seed && (name(up(cell)) ?? 'air') === 'air') {
            await bot.equip(seed, 'hand');
            await api.within(bot.placeBlock(bot.blockAt(at(cell)), new Vec3(0, 1, 0)), 4000, 'planting').catch(() => {});
            await api.sleep(200);
            if (CROP.test(name(up(cell)) ?? '')) did.planted += 1;
          }
        } catch (failure) {
          api.check();
          trouble.push(`${failure.message} at ${cell}`);
        }
      }
    }

    // 3 Light: three torches on the path reach every corner of both plots.
    if (wants('light')) for (const cell of plan.torches) {
      if (!time()) break;
      if (/torch/.test(name(cell) ?? '')) continue;
      if (!api.find(/^torch$/)) {
        if (!api.find(/^stick$/)) await api.craft('planks').then(() => api.craft('stick')).catch(() => {});
        const made = await api.craft('torch');
        if (!made.ok) { trouble.push(`no torch: ${made.error}`); break; }
      }
      await near(cell);
      await beside(cell);
      await clearPlant(cell);
      const put = await api.placeAt('torch', at(cell));
      if (put.ok) did.torches += 1; else trouble.push(`torch at ${cell}: ${put.error}`);
    }

    // 4 Fence, from whatever wood is carried, and the gate last and from outside: a fenced
    // field with the player inside it and no gate logic would be a pen.
    if (wants('fence')) {
      const missing = () => plan.ring.filter((cell) => !/_fence$/.test(name(cell) ?? ''));
      const fenceCarried = () => api.find(/_fence$/);
      const fences = () => bot.inventory.items().filter((item) => /_fence$/.test(item.name)).reduce((sum, item) => sum + item.count, 0);
      const gateWanted = () => !/_fence_gate$/.test(name(plan.gate) ?? '') && !api.find(/_fence_gate$/);
      // Everything is made first, at a bench outside the gateway. The first time, the fences ran
      // out with the ring two thirds closed and the nearest table on the far side of it: the
      // pathfinder built a step of earth on the tilled ground to climb out.
      if (missing().length > fences() || gateWanted()) {
        await api.walk(new goals.GoalNear(plan.outside[0], level + 1, plan.outside[2] + 1, 1), 60000, 'walking round to the gateway');
        await api.settle();
        if (!api.tableNear(8)) {
          if (!api.carried().crafting_table) { await wood(4); await api.craft('crafting_table'); }
          await clearPlant(plan.bench);
          const put = await api.placeAt('crafting_table', at(plan.bench));
          if (!put.ok) trouble.push(`bench: ${put.error}`);
        }
        while (time() && missing().length > fences()) {
          if (!(await makeFence())) { trouble.push(`${missing().length - fences()} fences short and no wood for them: ${fenceNeed(missing().length - fences())}`); break; }
        }
        if (gateWanted()) await makeGate();
      }
      // Each is placed from the ground outside the ring, so the player is never fenced in.
      const outsideOf = ([cx, , cz]) => [cx === x ? cx - 1 : cx === x + 20 ? cx + 1 : cx, level + 1, cz === z ? cz - 1 : cz === z + 10 ? cz + 1 : cz];
      for (let guard = 0; guard < 400 && time(); guard++) {
        const todo = missing();
        if (!todo.length || !fenceCarried()) break;
        const feet = bot.entity.position;
        const cell = todo.sort((a, b) => at(a).distanceTo(feet) - at(b).distanceTo(feet))[0];
        try {
          const stand = outsideOf(cell);
          if (at(stand).offset(0.5, 0, 0.5).distanceTo(feet) > 1.2) {
            await api.walk(new goals.GoalBlock(stand[0], stand[1], stand[2]), 30000, 'walking round the fence');
            await api.settle();
          }
          await clearPlant(cell);
          const put = await api.placeAt(fenceCarried().name, at(cell));
          if (put.ok) did.fences += 1; else { trouble.push(`fence at ${cell}: ${put.error}`); if (trouble.length > 12) break; }
        } catch (failure) {
          api.check();
          trouble.push(`${failure.message} at ${cell}`);
          if (trouble.length > 12) break;
        }
      }
      if (!missing().length && !/_fence_gate$/.test(name(plan.gate) ?? '') && time()) {
        if (!api.find(/_fence_gate$/)) await makeGate();
        const gate = api.find(/_fence_gate$/);
        if (!gate) trouble.push('no wood for the gate');
        else {
          await api.walk(new goals.GoalBlock(...plan.outside), 30000, 'walking out by the gateway');
          await api.settle();
          await clearPlant(plan.gate);
          const put = await api.placeAt(gate.name, at(plan.gate));
          if (put.ok) did.gate += 1; else trouble.push(`gate: ${put.error}`);
        }
      }
    }
    await leave();
  } catch (failure) {
    error = failure.message;
  } finally {
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
  }

  // Planks of one wood, sticks, then fences of that wood: 4 planks and 2 sticks make 3.
  async function wood(planksWanted) {
    for (let i = 0; i < 6; i++) {
      const planks = bot.inventory.items().filter((item) => item.name.endsWith('_planks')).sort((a, b) => b.count - a.count)[0];
      if (planks && planks.count >= planksWanted) return planks.name.replace(/_planks$/, '');
      const log = bot.inventory.items().filter((item) => /_log$/.test(item.name)).sort((a, b) => b.count - a.count)[0];
      if (!log) return null;
      const made = await api.craft(`${log.name.replace(/_log$/, '')}_planks`, Math.min(log.count, 4));
      if (!made.ok) return null;
    }
    return null;
  }
  async function makeFence() {
    if ((api.carried().stick ?? 0) < 2) {
      if (!(await wood(2))) return false;
      if (!(await api.craft('stick')).ok) return false;
    }
    const kind = await wood(4);
    if (!kind) return false;
    return (await api.craft(`${kind}_fence`)).ok;
  }
  async function makeGate() {
    if ((api.carried().stick ?? 0) < 4) {
      if (!(await wood(2))) return false;
      if (!(await api.craft('stick')).ok) return false;
    }
    const kind = await wood(2);
    if (!kind) return false;
    return (await api.craft(`${kind}_fence_gate`)).ok;
  }
  function fenceNeed(count) {
    const crafts = Math.ceil(count / 3);
    return `${count} fences are ${crafts * 4} planks and ${crafts * 2} sticks, about ${Math.ceil(crafts * 5 / 4)} logs`;
  }

  // What is there now, read from the world.
  const now = {
    water: plan.waters.filter((cell) => name(cell) === 'water').length,
    farmland: plan.plots.filter((cell) => name(cell) === 'farmland').length,
    crops: plan.plots.filter((cell) => CROP.test(name(up(cell)) ?? '')).length,
    torches: plan.torches.filter((cell) => /torch/.test(name(cell) ?? '')).length,
    fences: plan.ring.filter((cell) => /_fence$/.test(name(cell) ?? '')).length,
    gate: /_fence_gate$/.test(name(plan.gate) ?? '') ? 1 : 0,
    gateOpen: gateOpen(),
    inside: (() => { const feet = bot.entity.position.floored(); return feet.x > x && feet.x < x + 20 && feet.z > z && feet.z < z + 10; })(),
  };
  const whole = now.water === 2 && now.farmland === plan.plots.length && now.torches === 3 && now.fences === plan.ring.length && now.gate === 1;
  const done = Object.entries(did).filter(([, n]) => n).map(([what, n]) => `${what} ${n}`).join(', ');
  const note = `did: ${done || 'nothing'}. There now: water ${now.water} of 2, tilled ${now.farmland} of ${plan.plots.length}, crops ${now.crops}, torches ${now.torches} of 3, fences ${now.fences} of ${plan.ring.length}, gate ${now.gate} of 1${now.gate ? (now.gateOpen ? ' (open)' : ' (shut)') : ''}, the player ${now.inside ? 'inside' : 'outside'}${trouble.length ? `. Trouble: ${trouble.slice(0, 5).join('; ')}${trouble.length > 5 ? ` and ${trouble.length - 5} more` : ''}` : ''}${error ? `. Ended: ${error}` : ''}`;
  return { ok: Object.values(did).some((n) => n) || whole, note: note.slice(0, 900), now, whole };
}
