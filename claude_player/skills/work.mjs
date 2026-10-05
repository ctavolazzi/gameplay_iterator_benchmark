// One piece of a job of work on the land. A job is what a person asked for, kept in
// memory.works by chat.mjs (or `player.mjs job`): { id, kind, by, near, standAt }.
//
//   farm    choose the ground, level it, build the farm on it (build_farm.mjs)
//   clear   bring the land round a place down to one level (flatten.mjs)
//   trees   fell every tree round a place and keep the wood (fell_trees.mjs)
//
// Nothing about a job is fixed when it is asked for but its kind and where it was asked.
// Each time this runs it looks at the world again and does the first thing that is missing:
// surveys and chooses a site, makes room in the pack, digs, fills, builds. So a night, a
// fight or a restart in the middle costs nothing but the time. It is done when the world
// says so, and the job is marked then. The brain calls it by day while a job is open.
// args: { id, seconds: 400 }
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };
const FIELD = { w: 21, h: 11, margin: 4 };

export default async function work({ bot, api, memory, skill, note }, { id = null, seconds = 400 } = {}) {
  const land = await load('../land.mjs');
  const { survey } = await load('./survey_land.mjs');
  const job = (memory.works ?? []).find((w) => (id ? w.id === id : !w.done));
  if (!job) return { ok: true, note: 'no work is open' };
  const until = Date.now() + Math.max(30, Math.min(880, Number(seconds) || 400)) * 1000;
  const left = () => Math.max(15, Math.round((until - Date.now()) / 1000));
  const here = api.round(bot.entity.position);
  const near = job.near ?? (memory.home ? { x: memory.home.x, z: memory.home.z } : { x: here.x, z: here.z });
  const said = [];
  const tell = (text) => { said.push(text); note(text); };
  const finish = (text) => { job.done = Date.now(); job.result = text.slice(0, 200); return { ok: true, note: `${job.kind} for ${job.by}: done. ${said.join(' ')} ${text}`.slice(0, 900) }; };
  const more = (ok, text) => ({ ok, note: `${job.kind} for ${job.by}: ${said.join(' ')} ${text}`.slice(0, 900) });

  // A full pack loses whatever is made or dug next (the first farm's torches and fences).
  if (bot.inventory.emptySlotCount() < 4) tell((await skill('make_room')).note);

  // The ground is read where the job is. From far off it is not loaded: walk there first.
  if (Math.hypot(here.x - near.x, here.z - near.z) > 40) {
    await api.walk(new api.goals.GoalNearXZ(near.x, near.z, 12), 120000, `walking to where ${job.by} asked`);
  }
  const look = (reach) => survey(bot, api, { xa: near.x - reach, xb: near.x + reach, za: near.z - reach, zb: near.z + reach });
  // The level: the height asked for (where a player stands, so one under it), or the height most of the ground is at.
  const levelOf = (found) => job.level ?? (Number.isInteger(job.standAt) ? job.standAt - 1 : land.groundLevel(found.columns));

  if (job.kind === 'farm') {
    if (!job.site) {
      const found = look(36);
      const level = levelOf(found);
      const site = land.chooseSite(found, { w: FIELD.w, h: FIELD.h, level, near, reach: 34, margin: 2 });
      if (!site) return more(false, `no ground for a ${FIELD.w} by ${FIELD.h} field within 34 blocks of ${near.x} ${near.z} that is clear of water and of what is built`);
      job.site = { x: site.x, z: site.z };
      job.level = level;
      const line = `The farm goes at x ${site.x} to ${site.x + FIELD.w - 1}, z ${site.z} to ${site.z + FIELD.h - 1}, level with Y ${level + 1}: ${site.cut} blocks to dig, ${site.fill} to fill.`;
      bot.chat(line);
      tell(line);
    }
    const { x, z } = job.site;
    const level = job.level;
    const m = FIELD.margin;
    const cut = await skill('flatten', { x1: x - m, z1: z - m, x2: x + FIELD.w - 1 + m, z2: z + FIELD.h - 1 + m, level, seconds: left() });
    tell(`Levelling: ${cut.note}`);
    if (cut.left > 0) return more(cut.ok, 'More to dig.');
    // Once the fence is closed the field is entered by its gate only, and build_farm mends
    // its own ground from inside. Filled from outside, the way in is over the fence.
    const { ringClosed } = await load('./build_farm.mjs');
    if (!ringClosed(bot, x, z, level)) {
      const filled = await skill('fill_land', { x1: x, z1: z, x2: x + FIELD.w - 1, z2: z + FIELD.h - 1, level, seconds: Math.min(left(), 300) });
      tell(`Filling: ${filled.note}`);
      if (filled.left > 0) return more(filled.ok, 'More to fill.');
    }
    const built = await skill('build_farm', { x, z, level, seconds: left() });
    tell(`Building: ${built.note}`);
    memory.farmField = { x, z, level, now: built.now ?? null, at: Date.now() };
    if (!built.whole) return more(built.ok, 'More to build.');
    // A built field with nothing growing in it is not a farm yet: sowing it is the next job.
    if (!(memory.works ?? []).some((w) => w.kind === 'sow' && !w.done)) {
      memory.works.push({ id: `${Date.now().toString(36)}s`, kind: 'sow', by: job.by, site: { x, z }, level, near: { x: x + 10, z: z + 5 }, asked: new Date().toISOString() });
    }
    return finish('Water, tilled earth, light, fence and gate are all there. Sowing it comes next.');
  }

  if (job.kind === 'sow') {
    // Seeds come from grass. Whatever is carried is planted; then more grass is broken.
    const SEED = /^(wheat_seeds|carrot|potato|beetroot_seeds)$/;
    if (!api.find(SEED)) {
      const got = await skill('gather_seeds', { count: 12 });
      tell(`Seeds: ${got.note}`);
      if (!api.find(SEED)) return more(false, 'No seeds yet.');
    }
    const sown = await skill('build_farm', { x: job.site.x, z: job.site.z, level: job.level, seconds: left(), only: 'till' });
    tell(sown.note);
    const crops = sown.now?.crops ?? 0;
    return crops >= 160 ? finish(`${crops} blocks are growing.`) : more(sown.ok, `${crops} of 160 blocks are growing.`);
  }

  if (job.kind === 'clear') {
    const radius = job.radius ?? 16;
    job.level ??= levelOf(look(radius));
    const box = { xa: near.x - radius, xb: near.x + radius, za: near.z - radius, zb: near.z + radius };
    let leftOver = 0, dug = false;
    for (const piece of land.pieces(box, here, 12)) {
      if (left() <= 15) { leftOver += 1; continue; }
      const cut = await skill('flatten', { x1: piece.xa, z1: piece.za, x2: piece.xb, z2: piece.zb, level: job.level, seconds: left() });
      if (/^dug [1-9]/.test(cut.note)) { dug = true; tell(`${piece.xa} ${piece.za}: ${cut.note}`); }
      leftOver += cut.left > 0 ? 1 : 0;
    }
    return leftOver ? more(dug, `${leftOver} pieces of the ground round ${near.x} ${near.z} still stand above Y ${job.level + 1}.`)
      : finish(`Nothing stands above Y ${job.level + 1} within ${radius} blocks of ${near.x} ${near.z}.`);
  }

  if (job.kind === 'trees') {
    const felled = await skill('fell_trees', { near, radius: job.radius ?? 20, seconds: left() });
    tell(felled.note);
    return felled.left === 0 ? finish('') : more(felled.ok, 'More trees to fell.');
  }

  job.done = Date.now();
  return { ok: false, note: `no way to do a job of kind ${job.kind}` };
}
