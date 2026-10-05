// Work the farm (memory.farmField, the field skills/build_farm.mjs built). CT, 2026-10-04:
// "I also want you to work the farm so you will have food". In by the gate; every plant that
// is ripe is cut and its block sown again; tilled earth with nothing on it is sown from the
// pack; earth that has been trodden back to dirt is tilled again; out by the gate with it
// shut; and what wheat is carried is baked into bread at the bench. The loop is mineflayer's
// own examples/farmer.js with a walk in it. What is read back from the world is what is said.
// No args.
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };
const RIPE = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const SEED_FOR = { wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds' };
const SEED = /^(wheat_seeds|carrot|potato|beetroot_seeds)$/;

// Whether a crop block is ready to cut: its age is the last one that kind has.
export function ripe(name, age) {
  return name in RIPE && Number(age) >= RIPE[name];
}

export default async function tend({ bot, api, memory }, { seconds = 200 } = {}) {
  const field = memory.farmField;
  if (!field) return { ok: false, note: 'there is no farm yet' };
  const { farmPlan, ringClosed } = await load('./build_farm.mjs');
  const { x, z, level } = field;
  const plan = farmPlan(x, z, level);
  const { Vec3, goals } = api;
  const until = Date.now() + Math.max(20, Math.min(600, Number(seconds) || 200)) * 1000;
  const at = ([cx, cy, cz]) => new Vec3(cx, cy, cz);
  const up = ([cx, cy, cz]) => [cx, cy + 1, cz];
  const name = (cell) => bot.blockAt(at(cell))?.name ?? null;
  const age = (cell) => bot.blockAt(at(cell))?.getProperties?.().age;
  const isInside = () => { const feet = bot.entity.position.floored(); return feet.x > x && feet.x < x + 20 && feet.z > z && feet.z < z + 10; };
  const gate = at(plan.gate), outside = at(plan.outside), inside = new Vec3(plan.gate[0], level + 1, plan.gate[2] - 1);
  const closed = ringClosed(bot, x, z, level);
  const did = { cut: 0, sown: 0, tilled: 0, bread: 0 };
  let error = null;
  const before = api.carried();

  // Too far off to see the field: walk to its gate first.
  if (name(plan.gate) === null) await api.walk(new goals.GoalNear(outside.x, outside.y, outside.z, 4), 120000, 'walking to the farm');

  const count = () => {
    const now = { growing: 0, ripe: 0, bare: 0, dirt: 0 };
    for (const cell of plan.plots) {
      const crop = name(up(cell));
      if (name(cell) !== 'farmland') now.dirt += 1;
      else if (crop in RIPE) { if (ripe(crop, age(up(cell)))) now.ripe += 1; else now.growing += 1; }
      else now.bare += 1;
    }
    return now;
  };
  const wanted = (cell) => {
    const crop = name(up(cell));
    if (name(cell) !== 'farmland') return !!api.bestOf('_hoe');
    if (crop in RIPE) return ripe(crop, age(up(cell)));
    return !!api.find(SEED);
  };

  try {
    const todo = plan.plots.filter(wanted);
    if (todo.length) {
      if (closed && !isInside()) {
        const went = await api.through(gate, outside, inside);
        if (!went) throw new Error('could not get in at the gate');
      }
      // Row by row, there and back, so that the walk between plants is one step.
      const rows = todo.sort((a, b) => a[2] - b[2] || (a[2] % 2 ? b[0] - a[0] : a[0] - b[0]));
      for (const cell of rows) {
        api.check();
        if (Date.now() > until) break;
        if (!wanted(cell)) continue;
        try {
          if (at(cell).offset(0.5, 1, 0.5).distanceTo(bot.entity.position) > 3) {
            await api.walk(new goals.GoalNear(cell[0], level + 1, cell[2], 2), 15000, 'walking along the row');
          }
          const crop = name(up(cell));
          let seedName = null;
          if (crop in RIPE) {
            await api.within(bot.dig(bot.blockAt(at(up(cell))), true), 5000, `cutting the ${crop}`);
            did.cut += 1;
            seedName = SEED_FOR[crop];
            await api.sleep(350);
            // What it dropped lies on the block: step on to it.
            await api.walk(new goals.GoalBlock(cell[0], level + 1, cell[2]), 4000, 'picking up what was cut').catch(() => api.check());
            await api.sleep(250);
          }
          if (name(cell) !== 'farmland') {
            const hoe = api.bestOf('_hoe');
            if (!hoe || !/^(dirt|grass_block)$/.test(name(cell) ?? '') || (name(up(cell)) ?? 'air') !== 'air') continue;
            const feet = bot.entity.position.floored();
            if (feet.x === cell[0] && feet.z === cell[2]) continue;   // not the block under the player's feet
            await bot.equip(hoe, 'hand');
            await bot.lookAt(at(cell).offset(0.5, 1, 0.5), true);
            await api.within(bot.activateBlock(bot.blockAt(at(cell))), 4000, 'tilling');
            await api.sleep(250);
            if (name(cell) === 'farmland') did.tilled += 1; else continue;
          }
          if ((name(up(cell)) ?? 'air') !== 'air') continue;
          const seed = (seedName && api.find(new RegExp(`^${seedName}$`))) || api.find(SEED);
          if (!seed) continue;
          await bot.equip(seed, 'hand');
          await api.within(bot.placeBlock(bot.blockAt(at(cell)), new Vec3(0, 1, 0)), 4000, 'sowing').catch(() => {});
          await api.sleep(200);
          if ((name(up(cell)) ?? '') in RIPE) did.sown += 1;
        } catch (failure) {
          api.check();
          error = failure.message;
        }
      }
    }
  } catch (failure) {
    error = failure.message;
  } finally {
    // Out again whatever happened, and the gate shut: a player left in the field hops the fence.
    try { if (closed && isInside()) await api.through(gate, inside, outside); } catch { /* stopped on the way out */ }
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
  }

  // Bread: three wheat a loaf, at the bench by the gate.
  try {
    const loaves = Math.floor((api.carried().wheat ?? 0) / 3);
    if (loaves > 0 && !isInside()) {
      const baked = await api.craft('bread', loaves);
      if (baked.ok) did.bread = baked.made.bread ?? 0;
    }
  } catch (failure) {
    api.check();
    error ??= failure.message;
  }

  const now = count();
  const after = api.carried();
  field.tendedAt = Date.now();
  field.crops = now;
  const gained = ['wheat', 'wheat_seeds', 'bread', 'carrot', 'potato'].filter((n) => (after[n] ?? 0) !== (before[n] ?? 0)).map((n) => `${n} ${(after[n] ?? 0) - (before[n] ?? 0) > 0 ? '+' : ''}${(after[n] ?? 0) - (before[n] ?? 0)}`);
  const note = `cut ${did.cut}, sowed ${did.sown}, tilled ${did.tilled}, baked ${did.bread} bread. The field now: ${now.growing} growing, ${now.ripe} ripe, ${now.bare} tilled and bare, ${now.dirt} gone back to dirt. The pack: ${gained.join(', ') || 'no change'}; the player ${isInside() ? 'inside' : 'outside'}${error ? `. Trouble: ${error}` : ''}`;
  return { ok: !isInside() && (!error || did.cut + did.sown + did.tilled > 0), note: note.slice(0, 700), now };
}
