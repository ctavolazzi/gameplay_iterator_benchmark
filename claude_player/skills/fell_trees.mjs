// Fell every tree in a place, whole, and carry off the wood. CT, 2026-10-04: "eliminate all
// the surrounding trees entirely if they are slightly off the ground, they should be finished
// up and the wood harvested". What is left of a tree cut from below (logs hanging in the air)
// counts as a tree. A tree with anything made on it or against it (a treehouse, a ladder, a
// torch) is left standing: land.mjs trees() says which. Leaves are left to fall by themselves.
// What the player builds to climb is taken down again.
// args: { x1, z1, x2, z2 } or { near: { x, z }, radius: 20 }; seconds: 600; floatingOnly: false
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };
const SCAFFOLD = /^(dirt|cobblestone|cobbled_deepslate|stone|netherrack|andesite|diorite|granite|tuff)$/;

export default async function fellTrees({ bot, api }, { x1, z1, x2, z2, near = null, radius = 20, seconds = 600, floatingOnly = false }) {
  const { trees, MADE } = await load('../land.mjs');
  const { Vec3 } = api;
  const centre = near ?? (Number.isInteger(x1) ? null : api.round(bot.entity.position));
  const [xa, xb, za, zb] = centre
    ? [centre.x - radius, centre.x + radius, centre.z - radius, centre.z + radius]
    : [Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2)];
  if (![xa, xb, za, zb].every(Number.isFinite)) return { ok: false, note: 'say where: x1, z1, x2, z2 or near and radius' };
  const until = Date.now() + Math.max(10, Math.min(880, Number(seconds) || 600)) * 1000;
  const key = (p) => `${p.x},${p.y},${p.z}`;
  const people = () => Object.values(bot.players).filter((p) => p.entity && p.username !== bot.username).map((p) => p.entity.position);
  const byPerson = (at) => people().some((p) => Math.hypot(p.x - at.x - 0.5, p.z - at.z - 0.5) < 3 && Math.abs(p.y - at.y) < 8);
  const feetY = Math.floor(bot.entity.position.y);

  // Logs and made things, a little beyond the edge so that a tree on the edge is seen whole.
  function scan() {
    const logs = [], made = [];
    let leaves = 0;
    for (let x = xa - 4; x <= xb + 4; x++) for (let z = za - 4; z <= zb + 4; z++) for (let y = feetY - 12; y <= feetY + 45; y++) {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (!block || block.name === 'air') continue;
      if (block.name.endsWith('_log')) logs.push({ x, y, z, name: block.name });
      else if (MADE.test(block.name)) made.push({ x, y, z });
      else if (block.name.endsWith('_leaves') && x >= xa && x <= xb && z >= za && z <= zb) leaves += 1;
    }
    const solidUnder = (log) => {
      const under = bot.blockAt(new Vec3(log.x, log.y - 1, log.z));
      return under?.boundingBox === 'block' && !/_leaves$/.test(under.name);
    };
    const all = trees(logs, made, solidUnder);
    const inside = all.filter((t) => t.base.x >= xa && t.base.x <= xb && t.base.z >= za && t.base.z <= zb);
    return { inside, leaves, todo: inside.filter((t) => !t.kept && (!floatingOnly || t.floating)) };
  }

  // The solid blocks round a trunk that are not tree: what is there before the player climbs.
  function ground(tree) {
    const set = new Set();
    const top = tree.logs[tree.logs.length - 1].y;
    for (let x = tree.base.x - 4; x <= tree.base.x + 4; x++) for (let z = tree.base.z - 4; z <= tree.base.z + 4; z++) for (let y = tree.base.y - 2; y <= top + 3; y++) {
      const block = bot.blockAt(new Vec3(x, y, z));
      if (block?.boundingBox === 'block' && !/_log$|_leaves$/.test(block.name)) set.add(key({ x, y, z }));
    }
    return { set, top };
  }

  async function digHere(at, what) {
    const block = bot.blockAt(at);
    if (!block || block.boundingBox !== 'block') return null;
    if (at.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.62, 0)) > 4.4) return api.digAt(at, what);
    const tool = bot.pathfinder.bestHarvestTool(block);
    if (tool) await bot.equip(tool, 'hand');
    try {
      await api.within(bot.dig(block, true), 15000, `cutting the ${what}`);
    } catch (failure) {
      bot.stopDigging();
      throw failure;
    }
    return block.name;
  }

  const cut = {};
  const skipped = new Set();
  let felled = 0, floating = 0, tidied = 0, error = null;
  let pillarsLeft = null;   // null: the sweep for pillars was not reached this time
  const trouble = {};
  try {
    while (Date.now() < until) {
      api.check();
      const feet = bot.entity.position;
      const tree = scan().todo.filter((t) => !skipped.has(key(t.base)))
        .sort((a, b) => Math.hypot(a.base.x - feet.x, a.base.z - feet.z) - Math.hypot(b.base.x - feet.x, b.base.z - feet.z))[0];
      if (!tree) break;
      const before = ground(tree);
      let whole = true;
      for (const log of tree.logs) {
        api.check();
        if (Date.now() >= until) { whole = false; break; }
        const at = new Vec3(log.x, log.y, log.z);
        if (byPerson(at)) { whole = false; trouble['someone is standing by it'] = (trouble['someone is standing by it'] ?? 0) + 1; continue; }
        try {
          const name = await digHere(at, 'log');
          if (name) cut[name] = (cut[name] ?? 0) + 1;
        } catch (failure) {
          api.check();
          whole = false;
          const reason = String(failure.message).replace(/-?\d+/g, 'n').slice(0, 50);
          trouble[reason] = (trouble[reason] ?? 0) + 1;
        }
      }
      if (whole) { felled += 1; if (tree.floating) floating += 1; } else skipped.add(key(tree.base));
      // Down comes whatever was built to climb it: any block round the trunk that was not there before.
      for (let y = before.top + 3; y >= tree.base.y - 2; y--) for (let x = tree.base.x - 4; x <= tree.base.x + 4; x++) for (let z = tree.base.z - 4; z <= tree.base.z + 4; z++) {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (block?.boundingBox !== 'block' || !SCAFFOLD.test(block.name) || before.set.has(key({ x, y, z }))) continue;
        try { if (await digHere(new Vec3(x, y, z), 'scaffold')) tidied += 1; } catch { api.check(); }
      }
      await api.pickUp(8, 6);
    }
    // Then every pillar left standing: a block of building stone or earth with air on all four
    // sides is a tower the pathfinder climbed (the first morning's felling put down 94 blocks
    // and took 43 back). A tower built to reach the top of another is a pillar too, and comes
    // down from under the player's own feet. Nothing within 2 blocks of a made thing is touched.
    const open = (at) => bot.blockAt(at)?.boundingBox !== 'block';
    const pillars = () => {
      const out = [], made = [];
      for (let x = xa - 2; x <= xb + 2; x++) for (let z = za - 2; z <= zb + 2; z++) for (let y = feetY - 12; y <= feetY + 45; y++) {
        const at = new Vec3(x, y, z);
        const block = bot.blockAt(at);
        if (!block || block.name === 'air') continue;
        if (MADE.test(block.name)) { made.push(at); continue; }
        if (x < xa || x > xb || z < za || z > zb || !SCAFFOLD.test(block.name)) continue;
        if (open(at.offset(1, 0, 0)) && open(at.offset(-1, 0, 0)) && open(at.offset(0, 0, 1)) && open(at.offset(0, 0, -1))) out.push(at);
      }
      return out.filter((at) => !made.some((m) => Math.abs(m.x - at.x) <= 2 && Math.abs(m.y - at.y) <= 3 && Math.abs(m.z - at.z) <= 2) && !byPerson(at));
    };
    const gaveUp = new Set();
    while (Date.now() < until) {
      api.check();
      const todo = pillars().filter((at) => !gaveUp.has(key(at)));
      if (!todo.length) break;
      const eye = bot.entity.position.offset(0, 1.62, 0);
      const under = bot.entity.position.floored().offset(0, -1, 0);
      const reach = todo.filter((at) => at.offset(0.5, 0.5, 0.5).distanceTo(eye) <= 4.4)
        // Highest first, and the block the player stands on last of all.
        .sort((a, b) => (key(a) === key(under)) - (key(b) === key(under)) || b.y - a.y);
      const target = reach[0] ?? todo.sort((a, b) => a.distanceTo(eye) - b.distanceTo(eye))[0];
      try {
        if (await digHere(target, 'pillar')) tidied += 1;
      } catch (failure) {
        api.check();
        gaveUp.add(key(target));
      }
    }
    pillarsLeft = pillars().length;
  } catch (failure) {
    error = failure.message;
  } finally {
    bot.pathfinder.setGoal(null);
  }
  const after = scan();
  const logs = Object.entries(cut).map(([name, n]) => `${n} ${name}`).join(', ');
  const kept = after.inside.filter((t) => t.kept).length;
  const problems = Object.entries(trouble).map(([reason, n]) => `${reason} x${n}`).join(', ');
  const note = `felled ${felled} trees (${floating} of them hanging in the air), cut ${logs || 'no logs'}${tidied ? `, took down ${tidied} blocks of my own climbing` : ''}; ${after.todo.length} trees left to fell, ${kept} left standing because something is built on them, ${after.leaves} leaves still to fall, ${pillarsLeft === null ? 'pillars not looked for yet' : `${pillarsLeft} blocks of pillar left`}${problems ? `; ${problems}` : ''}${error ? `; ended: ${error}` : ''}`;
  // Not done until the pillars have been looked for and none stand.
  const left = after.todo.length + (pillarsLeft ?? 1);
  return { ok: felled > 0 || tidied > 0 || Object.keys(cut).length > 0 || left === 0, note: note.slice(0, 700), left };
}
