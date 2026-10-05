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

  // Work on the land is done from the land. At dawn on 2026-10-05 the brain gave the first
  // job of the day to a player 32 blocks down its mine.
  if (memory.home && here.y < memory.home.y - 8) {
    const up = await skill('surface', {});
    tell(`Up first: ${up.note}`);
    if (bot.entity.position.y < memory.home.y - 8) return more(up.ok, 'Still under ground.');
  }
  // The ground is read where the job is. From far off it is not loaded: walk there first.
  if (Math.hypot(here.x - near.x, here.z - near.z) > 40) {
    await api.walk(new api.goals.GoalNearXZ(near.x, near.z, 12), 120000, `walking to where ${job.by} asked`);
  }
  const look = (reach) => survey(bot, api, { xa: near.x - reach, xb: near.x + reach, za: near.z - reach, zb: near.z + reach });
  // The level: the height asked for (where a player stands, so one under it), or the height most of the ground is at.
  // Beside something already built it is that thing's level: the first storehouse was sited two
  // blocks under the farm next to it, because most of the ground toward the lake is lower.
  const field = memory.farmField;
  const beside = field && Math.hypot(field.x + 10 - near.x, field.z + 5 - near.z) < 48 ? field.level : null;
  const levelOf = (found) => job.level ?? (Number.isInteger(job.standAt) ? job.standAt - 1 : beside ?? land.groundLevel(found.columns));

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
    // With 40 plants in, the field seeds itself: every harvest gives more seed than it takes,
    // and skills/tend.mjs sows the bare earth from the pack. The grass near the farm was gone
    // after the first day, and looking for more took the player 290 blocks from home.
    const had = memory.farmField?.crops;
    if (had && had.growing + had.ripe >= 40 && Date.now() - (memory.farmField.tendedAt ?? 0) < 900000) {
      return finish(`${had.growing + had.ripe} of 160 blocks are growing, and the harvests will fill the rest.`);
    }
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

  if (job.kind === 'build') {
    // A building from plans.mjs: the ground chosen as a field's is, levelled, and built on.
    const { PLANS } = await load('../plans.mjs');
    const what = PLANS[job.what] ? job.what : 'storehouse';
    const size = PLANS[what]({ x: 0, y: 0, z: 0 }).size;
    if (!job.site) {
      const found = look(30);
      const level = levelOf(found);
      const site = land.chooseSite(found, { w: size.w, h: size.d, level, near, reach: 26, margin: 2 });
      if (!site) return more(false, `no ground for a ${size.w} by ${size.d} ${what} within 26 blocks of ${near.x} ${near.z} that is clear of water and of what is built`);
      job.site = { x: site.x, z: site.z };
      job.level = level;
      const line = `The ${what} goes at x ${site.x} to ${site.x + size.w - 1}, z ${site.z} to ${site.z + size.d - 1}, its door to the south.`;
      bot.chat(line);
      tell(line);
    }
    const { x, z } = job.site;
    const level = job.level;
    const built = await skill('build', { plan: what, x, y: level + 1, z, seconds: left() });
    if (/the ground is not ready/.test(built.note)) {
      const cut = await skill('flatten', { x1: x - 2, z1: z - 2, x2: x + size.w + 1, z2: z + size.d + 1, level, seconds: left() });
      tell(`Levelling: ${cut.note}`);
      if (cut.left > 0) return more(cut.ok, 'More to dig.');
      const filled = await skill('fill_land', { x1: x - 1, z1: z - 1, x2: x + size.w, z2: z + size.d, level, seconds: Math.min(left(), 300), anyTop: true });
      tell(`Filling: ${filled.note}`);
      // Said as it is: with 5 cells unfilled and nothing to fill them with this said "the
      // ground is made ready", was asked again, and said it ten times.
      return filled.left > 0 ? more(filled.ok, 'More to fill.') : more(true, 'The ground is made ready; building comes next.');
    }
    tell(`Building: ${built.note}`);
    return built.whole ? finish(`The ${what} is whole.`) : more(built.ok, 'More to build.');
  }

  if (job.kind === 'hall') {
    // The bigger base (skills/build_hall.mjs). What it takes comes out of the storehouse
    // first: a pickaxe, coal for torches, wood for chests.
    const carried = () => api.carried();
    const planks = () => Object.entries(carried()).filter(([item]) => item.endsWith('_planks')).reduce((sum, [, n]) => sum + n, 0);
    const logs = () => Object.entries(carried()).filter(([item]) => item.endsWith('_log')).reduce((sum, [, n]) => sum + n, 0);
    const torchesShort = Math.max(0, 6 - (memory.hall?.lit ?? 0) - (carried().torch ?? 0));
    // Chests are made last, when the room is otherwise whole: made first, they were put away
    // by the next goal to run, twice.
    const roomDone = memory.hall && memory.hall.faults === 0;
    const chestsShort = roomDone ? Math.max(0, 4 - (memory.hall?.chests ?? 0) - (carried().chest ?? 0)) : 0;
    // The gaps are closed with planks: what stone is carried, and wood for the rest.
    const stone = () => Object.entries(carried()).filter(([item]) => /^(cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|dirt)$/.test(item)).reduce((sum, [, n]) => sum + n, 0);
    const gapWood = roomDone ? 0 : Math.max(0, (memory.hall?.gaps ?? 80) + 12 - stone());
    const woodWanted = chestsShort * 8 + gapWood + (torchesShort ? 4 : 0) + (api.bestOf('_pickaxe') ? 0 : 4);
    const need = {};
    // A hall is 70 blocks of stone: not with a wooden pickaxe when an iron one is in the store.
    const goodPick = () => /^(iron|diamond|netherite)_pickaxe$/.test(api.bestOf('_pickaxe')?.name ?? '');
    if (!goodPick() && (memory.store?.holds?.[0]?.iron_pickaxe ?? 0) > 0) need.iron_pickaxe = 1;
    else if (!api.bestOf('_pickaxe')) need.iron_pickaxe = 1;
    if (torchesShort && (carried().coal ?? 0) < 2) need.coal = 4;
    if (planks() + logs() * 4 < woodWanted) need.log = Math.ceil((woodWanted - planks()) / 4) + 1;
    if (Object.keys(need).length && memory.store) {
      const got = await skill('take', { items: need });
      tell(`From the storehouse: ${got.note}`);
    }
    const make = async (item, times = 1) => { const made = await api.craft(item, times); if (!made.ok) tell(`${item}: ${made.error}`); return made.ok; };
    const wood = () => bot.inventory.items().filter((item) => /_log$/.test(item.name)).sort((a, b) => b.count - a.count)[0]?.name.replace(/_log$/, '');
    if (planks() < woodWanted && wood()) await make(`${wood()}_planks`, Math.ceil((woodWanted - planks()) / 4));
    if (!goodPick() && ((carried().diamond ?? 0) >= 3 || !api.bestOf('_pickaxe'))) {
      if ((carried().stick ?? 0) < 2) await make('stick');
      await make((carried().diamond ?? 0) >= 3 ? 'diamond_pickaxe' : 'stone_pickaxe');
    }
    if (torchesShort && (carried().coal ?? 0) >= 1) {
      if ((carried().stick ?? 0) < 2) await make('stick');
      await make('torch', Math.ceil(torchesShort / 4));
    }
    if (chestsShort && planks() >= 8) await make('chest', Math.min(chestsShort, Math.floor(planks() / 8)));
    const built = await skill('build_hall', { seconds: left() });
    tell(built.note);
    return built.whole ? finish('The hall and its stairs are whole.') : more(built.ok, 'More to build.');
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
