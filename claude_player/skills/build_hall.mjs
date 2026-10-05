// Build the bigger base from its plan (blueprint.mjs): a hall 7 by 7 and 3 high beside the
// bedroom, and a staircase from it up to the open air. fogsift, 06:17 on 2026-10-04: "Claude
// can you build a bigger base?"; CT, to the plan: "begin".
//
// Why it matters beyond the room: the ground outside the bedroom's doorway had been dug into
// pits by a dozen night shelters and trips down the mine, 75 of the hall's 147 cells were air
// before a block was dug, and the only way to the bed was through them. The hall gives those
// pits a floor and walls, and the stairs are a way home that is walked, not dug.
//
// It is built from the top of the stairs down, so that the player starts on the open ground
// and never has to find a way through the pits: stairs, the entrance, the room cell by cell
// outward from the entrance (each cell's floor is made whole before it is stood on), then the
// walls and the roof, light, and chests. It does what is missing, and the plan's own check
// (checkHall) says what is still wrong. args: { seconds: 600 }
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };
const FURNITURE = /^(chest|torch|wall_torch|crafting_table|furnace|.*_bed|ladder|.*_door)$/;
// Planks too: with no loose stone in reach of the stairs, the gaps over the pits are closed
// with wood from the storehouse. The pathfinder never digs planks, so they also stay closed.
const FILLER = /^(cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|dirt|.*_planks)$/;
const NEAR = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];

export default async function buildHall({ bot, api, memory }, { seconds = 600 } = {}) {
  const { hallPlan, checkHall } = await load('../blueprint.mjs');
  const c = memory.base;
  if (!c) return { ok: false, note: 'no base to build beside' };
  if (!api.bestOf('_pickaxe')) return { ok: false, note: 'no pickaxe: the hall is cut out of stone' };
  const { Vec3, goals } = api;
  const until = Date.now() + Math.max(30, Math.min(880, Number(seconds) || 600)) * 1000;
  const time = () => { api.check(); return Date.now() < until; };
  const at = ([x, y, z]) => new Vec3(x, y, z);
  const key = ([x, y, z]) => `${x},${y},${z}`;
  const block = (cell) => bot.blockAt(at(cell));
  const name = (cell) => block(cell)?.name ?? null;
  const solid = (cell) => block(cell)?.boundingBox === 'block';
  const wet = (cell) => NEAR.some(([dx, dy, dz]) => /water|lava/.test(name([cell[0] + dx, cell[1] + dy, cell[2] + dz]) ?? ''));
  const far = (cell) => at(cell).offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.62, 0));
  const did = { dug: 0, filled: 0, torches: 0, chests: 0 };
  const trouble = {};
  const say = (what) => { trouble[what] = (trouble[what] ?? 0) + 1; };
  const x = c.x + 6;

  // How many stairs reach the open air: the first whose standing cell has ground under it and
  // nothing over it. Read from near enough to see it.
  if (name([x, c.y + 7, c.z + 12]) === null) await api.walk(new goals.GoalNearXZ(x, c.z + 12, 6), 120000, 'walking to where the stairs come up');
  let steps = memory.hall?.steps ?? null;
  for (let j = 3; steps === null && j <= 24; j++) {
    const stand = [x, c.y + j, c.z + 5 + j];
    if (!solid([stand[0], stand[1] - 1, stand[2]])) continue;
    let open = true;
    for (let up = 0; up <= 24 && open; up++) if (solid([stand[0], stand[1] + up, stand[2]])) open = false;
    if (open) steps = j;
  }
  if (steps === null) return { ok: false, note: 'no place within 24 stairs where the staircase comes out under the sky' };
  const plan = hallPlan(c, steps);
  const standOf = (j) => [x, c.y + j, c.z + 5 + j];
  // The hatch: the one column under the hall's far corner (south-east) that is left open and
  // unguarded. It is the way down to the mine and back (lib.mjs make() has the other half).
  // Before it, the way to the mine from a closed hall was through a wall or up to the lawn.
  const hatch = [c.x + 9, c.y - 1, c.z + 3];
  const overHatch = (cell) => cell[0] === hatch[0] && cell[2] === hatch[2] && cell[1] <= c.y;
  // What must stay open: nothing is ever placed in these.
  const keepOpen = new Set([...plan.interior, ...plan.entrance, ...plan.bedroomDoor, ...plan.stairs.flatMap((s) => s.clear)].map((cell) => `${cell[0]},${cell[1]},${cell[2]}`));

  async function dig(cell) {
    const here = block(cell);
    if (!here || here.boundingBox !== 'block' || FURNITURE.test(here.name)) return true;
    if (wet(cell)) { say('water or lava against a block to be dug'); return false; }
    if (far(cell) > 4.5) { say('a block to dig out of reach'); return false; }
    const tool = bot.pathfinder.bestHarvestTool(here);
    if (tool) await bot.equip(tool, 'hand');
    try {
      await api.within(bot.dig(here, true), 20000, `digging ${here.name}`);
      did.dug += 1;
      return true;
    } catch (failure) {
      bot.stopDigging();
      api.check();
      say('a block that would not dig');
      return false;
    }
  }
  // A gap over a pit has nothing beside it to build against (the foot of the stairs hung over
  // one). Then the way to it is built first: the shortest chain of empty cells from something
  // solid, through cells that are rock in the plan, never through one that must stay open.
  async function fill(cell) {
    if (solid(cell) || FURNITURE.test(name(cell) ?? '')) return true;
    if (await put(cell)) return true;
    const seen = new Set([key(cell)]);
    let frontier = [[cell]];
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      const next = [];
      for (const chain of frontier) {
        const last = chain[chain.length - 1];
        for (const [dx, dy, dz] of NEAR) {
          const step = [last[0] + dx, last[1] + dy, last[2] + dz];
          if (seen.has(key(step)) || keepOpen.has(key(step)) || solid(step) || far(step) > 4.4) continue;
          seen.add(key(step));
          const grown = [...chain, step];
          if (NEAR.some(([ex, ey, ez]) => solid([step[0] + ex, step[1] + ey, step[2] + ez]))) {
            for (const link of grown.reverse()) if (!(await put(link))) return false;
            return solid(cell);
          }
          next.push(grown);
        }
      }
      frontier = next;
    }
    say('a gap with nothing near it to build from');
    return false;
  }
  // A block of stone into an empty cell, against whatever is solid beside it.
  async function put(cell) {
    if (solid(cell)) return true;
    if (FURNITURE.test(name(cell) ?? '')) return true;
    const item = bot.inventory.items().filter((it) => FILLER.test(it.name)).sort((a, b) => b.count - a.count)[0];
    if (!item) { say('no stone left to build with'); return false; }
    if (far(cell) > 4.5) { say('a gap out of reach'); return false; }
    const feet = bot.entity.position.floored();
    if (feet.x === cell[0] && feet.z === cell[2] && (feet.y === cell[1] || feet.y + 1 === cell[1])) { say('a gap where the player stands'); return false; }
    // Something growing in the gap (a wheat plant from the first day stood in the hall's west
    // wall): it is cut first, or nothing can be put there.
    const growing = block(cell);
    if (growing && growing.name !== 'air' && growing.boundingBox !== 'block' && !/water|lava/.test(growing.name)) {
      await api.within(bot.dig(growing, true), 5000, `clearing ${growing.name}`).catch(() => {});
      await api.sleep(150);
    }
    await bot.equip(item, 'hand');
    for (const [dx, dy, dz] of NEAR) {
      const against = block([cell[0] + dx, cell[1] + dy, cell[2] + dz]);
      if (against?.boundingBox !== 'block' || FURNITURE.test(against.name)) continue;
      await api.within(bot.placeBlock(against, new Vec3(-dx, -dy, -dz)), 4000, 'closing a gap').catch(() => {});
      await api.sleep(120);
      if (solid(cell)) { did.filled += 1; return true; }
    }
    return false;
  }

  // Walking inside what is finished: nothing dug, nothing placed, and no step on a cell of
  // the room whose floor has not been made yet (under most of them was a pit).
  const done = new Set();
  const inRoom = (p) => p && p.x >= c.x + 3 && p.x <= c.x + 9 && p.z >= c.z - 3 && p.z <= c.z + 3 && p.y >= c.y - 6 && p.y <= c.y + 2;
  async function moveTo(cell, ms = 20000) {
    const p = bot.entity.position;
    if (Math.abs(p.x - cell[0] - 0.5) < 0.4 && Math.abs(p.z - cell[2] - 0.5) < 0.4 && Math.abs(p.y - cell[1]) < 0.6) return true;
    const moves = bot.pathfinder.movements;
    const was = { canDig: moves.canDig, towers: moves.allow1by1towers, scaffold: moves.scafoldingBlocks, step: moves.exclusionAreasStep };
    moves.canDig = false;
    moves.allow1by1towers = false;
    moves.scafoldingBlocks = [];
    moves.exclusionAreasStep = [...(was.step ?? []), (b) => (inRoom(b.position) && (!done.has(`${b.position.x},${b.position.z}`) || overHatch([b.position.x, 0, b.position.z])) ? 100 : 0)];
    try {
      await api.within(bot.pathfinder.goto(new goals.GoalBlock(cell[0], cell[1], cell[2])), ms, 'moving in the hall');
    } catch (failure) {
      bot.pathfinder.setGoal(null);
      api.check();
      return false;
    } finally {
      Object.assign(moves, { canDig: was.canDig, allow1by1towers: was.towers, scafoldingBlocks: was.scaffold, exclusionAreasStep: was.step });
    }
    await api.settle();
    return true;
  }

  let error = null;
  let stage = 'stairs';
  try {
    // 1 The stairs, from the top down. Standing on one, the next one down is opened (its three
    // cells, top first), its tread made whole, and then it is stepped on to.
    const top = standOf(steps);
    const here = bot.entity.position;
    const onStairs = Math.abs(here.x - x - 0.5) < 0.6 && here.z >= c.z + 4 && here.z <= c.z + 6 + steps;
    if (!onStairs && !inRoom(here.floored())) await api.walk(new goals.GoalBlock(top[0], top[1], top[2]), 120000, 'walking to the head of the stairs');
    await api.settle();
    if (!inRoom(bot.entity.position.floored())) {
      const from = Math.min(steps, Math.max(0, Math.round(bot.entity.position.z - c.z - 5)));
      for (let j = from - 1; j >= 0 && time(); j--) {
        const stair = plan.stairs[j];
        for (const cell of stair.clear) await dig(cell);
        await fill(stair.floor);
        if (!solid(stair.floor) || stair.clear.some(solid)) { say(`stair ${j} could not be made`); break; }
        if (!(await moveTo(standOf(j)))) { say(`stair ${j} could not be stepped on to`); break; }
      }
    }

    // 2 The entrance: two cells in the hall's south wall, at the foot of the stairs.
    stage = 'entrance';
    const foot = standOf(0);
    const feet = bot.entity.position.floored();
    const atFoot = feet.x === foot[0] && feet.z === foot[2] && Math.abs(feet.y - foot[1]) <= 1;
    if ((atFoot || inRoom(feet)) && time()) {
      const [low, high] = plan.entrance;
      const first = [c.x + 6, c.y, c.z + 3];
      if (atFoot) {
        await dig(high);
        await dig(low);
        await fill([low[0], low[1] - 1, low[2]]);
        await moveTo(low);
      }

      // 3 The room, a cell at a time outward from the entrance. For each: the floor under it
      // made whole, then the cell and the two over it opened. A cell is stood on only after that.
      stage = 'room';
      const order = [];
      const seen = new Set([`${first[0]},${first[2]}`]);
      const queue = [{ cell: first, parent: low }];
      while (queue.length) {
        const next = queue.shift();
        order.push(next);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cell = [next.cell[0] + dx, c.y, next.cell[2] + dz];
          if (cell[0] < c.x + 3 || cell[0] > c.x + 9 || cell[2] < c.z - 3 || cell[2] > c.z + 3 || seen.has(`${cell[0]},${cell[2]}`)) continue;
          seen.add(`${cell[0]},${cell[2]}`);
          queue.push({ cell, parent: next.cell });
        }
      }
      const whole = ({ cell }) => (solid([cell[0], c.y - 1, cell[2]]) || overHatch(cell)) && [0, 1, 2].every((dy) => !solid([cell[0], c.y + dy, cell[2]]) || FURNITURE.test(name([cell[0], c.y + dy, cell[2]]) ?? ''));
      for (const next of order) {
        if (!time()) break;
        const { cell, parent } = next;
        if (whole(next)) { done.add(`${cell[0]},${cell[2]}`); continue; }
        if (far([cell[0], c.y + 1, cell[2]]) > 3.4 || far([cell[0], c.y - 1, cell[2]]) > 4.3) await moveTo(parent);
        if (!overHatch(cell)) await fill([cell[0], c.y - 1, cell[2]]);
        for (const dy of [2, 1, 0]) await dig([cell[0], c.y + dy, cell[2]]);
        if (whole(next)) done.add(`${cell[0]},${cell[2]}`);
        else say('a cell of the room that could not be finished');
      }

      // 4 The walls, the floor's edge and the roof: every gap in the shell, from the nearest
      // finished cell of the floor. Twice over, for a gap whose neighbour was a gap too.
      stage = 'shell';
      const floorCells = order.map((o) => o.cell).filter((cell) => done.has(`${cell[0]},${cell[2]}`));
      for (let pass = 0; pass < 3 && time() && floorCells.length; pass++) {
        const gaps = plan.shell.filter((cell) => !solid(cell) && !FURNITURE.test(name(cell) ?? '') && !overHatch(cell));
        if (!gaps.length) break;
        for (const gap of gaps) {
          if (!time()) break;
          if (far(gap) > 4.3) {
            const stand = [...floorCells].sort((a, b) => Math.hypot(a[0] - gap[0], a[2] - gap[2]) - Math.hypot(b[0] - gap[0], b[2] - gap[2]))[0];
            await moveTo(stand);
          }
          await fill(gap);
        }
      }

      // The stairs again, from the foot up: a tread that has gone since is put back, and
      // whatever has fallen into the way is taken out. (One tread was dug away by the player's
      // own search for coal between two steps of this job.)
      stage = 'stairs again';
      for (let j = 0; j <= steps && time(); j++) {
        const stair = plan.stairs[j];
        if (solid(stair.floor) && !stair.clear.some(solid)) continue;
        if (!(await moveTo(j === 0 ? plan.entrance[0] : standOf(j - 1)))) { say(`stair ${j} could not be come at from below`); break; }
        for (const cell of stair.clear) await dig(cell);
        await fill(stair.floor);
        if (!solid(stair.floor)) { say(`stair ${j} could not be put back`); break; }
      }

      // The sides of the stairs. The plan gives the stairs treads and headroom and nothing
      // beside them, and beside them were the pits: at 23:52 on 2026-10-04 a zombie and a
      // skeleton came at the player from there and took it from 20 health to 5. Every cell
      // beside a stair, from its tread to its headroom and no higher than the ground, is closed.
      stage = 'stair walls';
      const ground = c.y + steps - 1;
      let open = 0;
      for (let j = 0; j < steps && time(); j++) {
        const [sx, sy, sz] = standOf(j);
        const sides = [-1, 1].flatMap((side) => [-1, 0, 1, 2].map((dy) => [sx + side, sy + dy, sz]))
          .filter((cell) => cell[1] <= ground && !solid(cell) && !FURNITURE.test(name(cell) ?? ''));
        if (!sides.length) continue;
        if (!(await moveTo(standOf(j)))) { say('a stair that could not be reached to wall it'); open += sides.length; continue; }
        for (const cell of sides) if (!(await fill(cell))) open += 1;
      }
      if (open) say(`${open} cells beside the stairs still open`);

      // 5 Light: a room under ground fills with monsters in the dark.
      stage = 'light';
      for (const cell of plan.torches) {
        if (!time() || !api.find(/^torch$/)) break;
        if (/torch/.test(name(cell) ?? '') || solid(cell) || !solid([cell[0], cell[1] - 1, cell[2]])) continue;
        if (far(cell) > 4) {
          const stand = cell[2] > c.z + 4 ? cell : [...floorCells].sort((a, b) => Math.hypot(a[0] - cell[0], a[2] - cell[2]) - Math.hypot(b[0] - cell[0], b[2] - cell[2]))[1] ?? floorCells[0];
          if (stand) await moveTo(stand);
        }
        const put = await api.placeAt('torch', at(cell));
        if (put.ok) did.torches += 1;
      }

      // 6 Chests along the north wall.
      stage = 'chests';
      for (const cell of plan.chests) {
        if (!time() || !api.find(/^chest$/)) break;
        if (name(cell) === 'chest' || !done.has(`${cell[0]},${cell[2]}`)) continue;
        const stand = [cell[0], c.y, cell[2] + 2];
        await moveTo(stand);
        const put = await api.placeAt('chest', at(cell));
        if (put.ok) did.chests += 1;
      }
    }
  } catch (failure) {
    error = failure.message;
  } finally {
    bot.clearControlStates();
    bot.pathfinder.setGoal(null);
  }

  // What the plan's own check says of the world as it now is.
  // Furniture, to the check, is what cannot be walked through: a chest, a table, a bed. A torch
  // can be (the plan stands two of them on the stairs, and the first check called the stairs
  // blocked at the first one).
  // The hatch is not a fault: an open floor there is what it is for.
  const faults = checkHall(plan, { open: (cell) => !solid(cell), solid, furniture: (cell) => /^(chest|crafting_table|furnace|.*_bed)$/.test(name(cell) ?? '') })
    .filter((fault) => !overHatch(fault.cell));
  const kinds = {};
  for (const fault of faults) kinds[fault.what.replace(/\d+/g, 'n')] = (kinds[fault.what.replace(/\d+/g, 'n')] ?? 0) + 1;
  const lit = plan.torches.filter((cell) => /torch/.test(name(cell) ?? '')).length;
  const chests = plan.chests.filter((cell) => name(cell) === 'chest').length;
  const gaps = plan.shell.filter((cell) => !solid(cell) && !FURNITURE.test(name(cell) ?? '') && !overHatch(cell)).length + plan.stairs.filter((stair) => !solid(stair.floor)).length;
  memory.hall = { c: { x: c.x, y: c.y, z: c.z }, steps, at: Date.now(), faults: faults.length, gaps, lit, chests, whole: faults.length === 0, hatch: { x: hatch[0], y: c.y, z: hatch[2] } };
  const problems = Object.entries(trouble).map(([what, n]) => `${what} x${n}`).join(', ');
  const note = `dug ${did.dug}, filled ${did.filled}, torches ${did.torches}, chests ${did.chests}. ${steps} stairs. `
    + `${faults.length ? `The check finds ${faults.length} faults (${Object.entries(kinds).map(([what, n]) => `${what} ${n}`).join(', ')})` : 'The check finds no fault: the room is whole, closed, and walked from the bedroom to the top of the stairs'}; `
    + `${faults.length ? `first at ${faults.slice(0, 4).map((f) => `${f.cell.join(' ')} (${f.what.replace(/^(a |the )/, '').slice(0, 24)}: ${name(f.cell)})`).join(', ')}; ` : ''}`
    + `${lit} of ${plan.torches.length} torches, ${chests} of ${plan.chests.length} chests${problems ? `. Trouble: ${problems}` : ''}${error ? `. Ended in the ${stage}: ${error}` : ''}`;
  return { ok: did.dug + did.filled + did.torches + did.chests > 0 || faults.length === 0, note: note.slice(0, 900), whole: faults.length === 0 && lit >= 4, faults: faults.length };
}
