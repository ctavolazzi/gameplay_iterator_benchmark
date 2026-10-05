// Bring the land in a rectangle down to one level: everything above it is dug away, hills and
// trees alike. CT, 2026-10-04: "flatten the surrounding terrain by dropping everything down to
// the 66th block level". level is the highest block that stays, so a player stands on it at
// level + 1 (65 for standing at 66). Nothing at or under the level is touched, nothing a
// player has made is dug, and nothing is dug within 3 blocks of another player.
// args: { x1, z1, x2, z2, level: 65, seconds: 600, keep: [[xa, za, xb, zb], ...] }
// It ends when the time is up or nothing is left, and says how much is left. Run it again.

import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };
const KEPT = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks|glass|glass_pane|.*_glass|farmland|wheat|composter|.*_banner|lantern|campfire|.*_wall|bedrock)$/;
const NEXT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]];

export default async function flatten({ bot, api }, { x1, z1, x2, z2, level = 65, seconds = 600, keep = [], top = 40, dry = false }) {
  if (![x1, z1, x2, z2, level].every(Number.isInteger)) return { ok: false, note: 'say the corners and the level: x1, z1, x2, z2, level' };
  const [xa, xb, za, zb] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2)];
  const until = Date.now() + Math.max(10, Math.min(880, Number(seconds) || 600)) * 1000;
  const { Vec3, goals } = api;
  const key = (at) => `${at.x},${at.y},${at.z}`;
  const kept = (x, z) => keep.some(([a, b, c, d]) => x >= a && x <= c && z >= b && z <= d);
  const people = () => Object.values(bot.players).filter((p) => p.entity && p.username !== bot.username).map((p) => p.entity.position);
  const byPerson = (at, who) => who.some((p) => Math.hypot(p.x - at.x - 0.5, p.z - at.z - 0.5) < 3 && Math.abs(p.y - at.y) < 6);
  const leafy = (name) => name.endsWith('_leaves');
  const later = new Map();   // cells that could not be dug or reached, and when to try again
  const why = {};
  const put = (reason) => { why[reason] = (why[reason] ?? 0) + 1; };

  // What is built here, and the trees that hold it up (a treehouse is a tree with planks in
  // it: land.mjs trees() says which trees those are). Read once, before anything is dug.
  // Guarded: a kept tree's logs, the leaves round them, and any block with something made
  // standing over it within a block to the side.
  const { trees, MADE } = await load('../land.mjs');
  const madeAt = [], logsAt = [];
  for (let x = xa - 6; x <= xb + 6; x++) for (let z = za - 6; z <= zb + 6; z++) for (let y = level - 2; y <= level + top; y++) {
    const name = bot.blockAt(new Vec3(x, y, z))?.name ?? '';
    if (MADE.test(name)) madeAt.push({ x, y, z });
    else if (name.endsWith('_log')) logsAt.push({ x, y, z });
  }
  const keptLogs = trees(logsAt, madeAt, () => true).filter((tree) => tree.kept).flatMap((tree) => tree.logs);
  const keptLog = new Set(keptLogs.map(key));
  const guarded = (at, name) => keptLog.has(key(at))
    || (leafy(name) && keptLogs.some((log) => Math.abs(log.x - at.x) <= 5 && Math.abs(log.y - at.y) <= 5 && Math.abs(log.z - at.z) <= 5))
    || madeAt.some((m) => m.y > at.y && m.y - at.y <= 12 && Math.abs(m.x - at.x) <= 1 && Math.abs(m.z - at.z) <= 1);

  // Every block above the level that is to go. wet: blocks left because water or lava touches them.
  function scan() {
    const cells = [];
    let wet = 0, made = 0;
    for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
      if (kept(x, z)) continue;
      for (let y = level + top; y > level; y--) {
        const at = new Vec3(x, y, z);
        const block = bot.blockAt(at);
        if (!block || block.boundingBox !== 'block') continue;
        const above = bot.blockAt(at.offset(0, 1, 0))?.name ?? '';
        if (KEPT.test(block.name) || KEPT.test(above) || guarded(at, block.name)) { made += 1; continue; }
        if (NEXT.some(([dx, dy, dz]) => /water|lava/.test(bot.blockAt(at.offset(dx, dy, dz))?.name ?? ''))) { wet += 1; continue; }
        cells.push({ at, name: block.name });
      }
    }
    return { cells, wet, made };
  }

  // While this runs the pathfinder does not dig into the ground that is to stay, and builds no towers.
  const moves = bot.pathfinder.movements;
  const was = { breaks: moves.exclusionAreasBreak, towers: moves.allow1by1towers };
  moves.exclusionAreasBreak = [...(was.breaks ?? []), (block) => (block.position && block.position.y <= level
    && block.position.x >= xa - 4 && block.position.x <= xb + 4 && block.position.z >= za - 4 && block.position.z <= zb + 4 ? 200 : 0)];
  moves.allow1by1towers = false;

  // dry: say what would be dug and dig nothing.
  if (dry) {
    const found = scan();
    const names = {};
    for (const cell of found.cells) names[cell.name] = (names[cell.name] ?? 0) + 1;
    moves.exclusionAreasBreak = was.breaks;
    moves.allow1by1towers = was.towers;
    return { ok: true, left: found.cells.length, note: `would dig ${found.cells.length}: ${Object.entries(names).map(([name, n]) => `${n} ${name}`).join(', ') || 'nothing'}; ${found.made} kept as built or holding a build up, ${found.wet} by water; first ${JSON.stringify(found.cells.slice(0, 6).map((c) => [c.at.x, c.at.y, c.at.z]))}` };
  }

  const dug = {};
  let count = 0, left = null, error = null;
  async function digOne(cell) {
    const block = bot.blockAt(cell.at);
    if (!block || block.boundingBox !== 'block') return;
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    try {
      await api.within(bot.dig(block, true), 15000, `digging ${block.name}`);
      dug[block.name] = (dug[block.name] ?? 0) + 1;
      count += 1;
    } catch (failure) {
      bot.stopDigging();
      api.check();
      later.set(key(cell.at), Date.now() + 30000);
      put(`could not dig ${block.name}`);
    }
  }

  try {
    while (Date.now() < until) {
      api.check();
      const who = people();
      const found = scan();
      const open = found.cells.filter((c) => !(later.get(key(c.at)) > Date.now()) && !byPerson(c.at, who));
      left = { blocks: found.cells.length, wet: found.wet, made: found.made, held: found.cells.length - open.length };
      // Trunks and earth first. Leaves fall away by themselves once their trunk is gone, so they
      // are only dug when nothing else is left.
      const hard = open.filter((c) => !leafy(c.name));
      const work = hard.length ? hard : open;
      if (!work.length) break;
      const eye = bot.entity.position.offset(0, 1.62, 0);
      const far = (c) => c.at.offset(0.5, 0.5, 0.5).distanceTo(eye);
      const near = work.filter((c) => far(c) <= 4.4).sort((a, b) => b.at.y - a.at.y || far(a) - far(b));
      if (near.length) {
        // From the top down, a handful at a time, then look again: the world has changed.
        for (const cell of near.slice(0, 12)) { api.check(); await digOne(cell); }
        continue;
      }
      // Nothing in reach: walk to the nearest. A trunk too high to reach from the ground is
      // left to api.digAt, which may build its way up.
      const feet = bot.entity.position;
      const target = work.sort((a, b) => (a.at.distanceTo(feet) + Math.max(0, a.at.y - feet.y - 3) * 4) - (b.at.distanceTo(feet) + Math.max(0, b.at.y - feet.y - 3) * 4))[0];
      try {
        await api.walk(new goals.GoalNear(target.at.x, Math.min(target.at.y, Math.floor(feet.y) + 3), target.at.z, 3), 25000, 'walking to the next block', true);
      } catch (failure) {
        api.check();
        put(`no way to ${target.name}`);
      }
      await api.settle();
      const now = bot.entity.position.offset(0, 1.62, 0);
      if (target.at.offset(0.5, 0.5, 0.5).distanceTo(now) > 4.4) {
        moves.allow1by1towers = was.towers;
        try {
          const name = await api.digAt(target.at, target.name);
          dug[name] = (dug[name] ?? 0) + 1;
          count += 1;
        } catch (failure) {
          api.check();
          later.set(key(target.at), Date.now() + 90000);
          put(`could not get to ${target.name}`);
        } finally {
          moves.allow1by1towers = false;
        }
      }
    }
  } catch (failure) {
    error = failure.message;
  } finally {
    moves.exclusionAreasBreak = was.breaks;
    moves.allow1by1towers = was.towers;
    bot.pathfinder.setGoal(null);
  }
  const after = scan();
  const tally = Object.entries(dug).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${n} ${name}`).join(', ');
  const trouble = Object.entries(why).map(([reason, n]) => `${reason} x${n}`).join(', ');
  const note = `dug ${count} (${tally || 'nothing'}); ${after.cells.length} left above ${level}, ${after.wet} by water, ${after.made} made things kept${trouble ? `; ${trouble}` : ''}${error ? `; ended: ${error}` : ''}`;
  return { ok: count > 0 || after.cells.length === 0, note: note.slice(0, 600), left: after.cells.length };
}
