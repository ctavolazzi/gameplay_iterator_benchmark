#!/usr/bin/env node
// The curriculum: which advancement the player goes for next, and which it has no way to
// earn yet. The idea is Voyager's (RESEARCH.md): the next task comes from where the player
// stands (what it has done, what failed, what it has), and it is "not too hard". Here no
// model proposes it. The game's own tree does: an advancement is open when the one before it
// is earned, and the program either has a way to it or it does not.
//
// What has no way is the curriculum's request to the Claude session: write a skill, or tell
// the planner where a thing comes from, and the next survey finds it ready with no change to
// the brain. The proof that one was earned is the server's log, never this file.
//
//   node claude_player/curriculum.mjs            where the player stands, from the server's log
import { fileURLToPath } from 'node:url';

export const TABS = ['story', 'husbandry', 'adventure', 'nether', 'end'];

// Ways the program has to an advancement that are not "have this item": the goal in
// brain.mjs that works toward it, or the reflex that earns it in passing.
export const WAYS = {
  'story/mine_stone': { goal: 'stone pickaxe' },
  'story/upgrade_tools': { goal: 'stone pickaxe' },
  'story/smelt_iron': { goal: 'iron pickaxe' },
  'story/obtain_armor': { goal: 'Suit Up' },
  'story/iron_tools': { goal: 'iron pickaxe' },
  'story/mine_diamond': { goal: 'Diamonds!' },
  'story/shiny_gear': { goal: 'diamond chestplate' },
  'story/deflect_arrow': { reflex: 'the shield goes up against what shoots' },
  'husbandry/plant_seed': { goal: 'A Seedy Place' },
  'husbandry/breed_an_animal': { goal: 'The Parrots and the Bats' },
  'adventure/kill_a_mob': { reflex: 'what comes close is fought' },
  'adventure/sleep_in_bed': { goal: 'sleep' },
  'adventure/voluntary_exile': { reflex: 'a raid captain met and killed' },
};

// How far off each open advancement is, as the session judges it (1 is next door), and what a
// way to it would have to do. What is not here counts as 8. The game's tree says what is
// open; this says what is near, and it is the order the requests are made in.
export const EFFORT = {
  'story/lava_bucket': [1, 'the bucket filled at lava that lies open (skill fill_bucket; lava is in the deep caves)'],
  'husbandry/breed_an_animal': [1, 'two chickens fed seeds, or two sheep or cows fed wheat from the plot'],
  'husbandry/fishy_business': [2, 'a fishing rod (3 sticks, 2 string from spiders), cast in water until the bobber dips'],
  'adventure/shoot_arrow': [2, 'a bow (3 sticks, 3 string), an arrow, and a shot that hits anything'],
  'husbandry/tame_an_animal': [3, 'bones from skeletons given to a wolf, or raw fish to a cat'],
  'adventure/ol_betsy': [3, 'a crossbow (3 sticks, 2 string, an iron ingot, a tripwire hook), loaded and shot'],
  'story/enchant_item': [4, 'an enchanting table (4 obsidian, 2 diamonds, a book), lapis, and levels'],
  'adventure/trade': [4, 'a village, and something a villager buys'],
  'husbandry/balanced_diet': [7, 'every food in the game eaten once'],
  'adventure/kill_all_mobs': [7, 'one of every hostile creature killed'],
  'adventure/adventuring_time': [7, 'every biome visited'],
};

// The items an advancement is earned by having: one list of alternatives for each of its
// groups. null when any group needs something other than an item in the pack.
export function itemsFor(advancement) {
  const byName = new Map(advancement.criteria.map((c) => [c.name, c]));
  const out = [];
  for (const group of advancement.groups) {
    const items = group.flatMap((name) => byName.get(name)?.items ?? []).filter((item) => !item.startsWith('#'));
    if (!items.length) return null;
    out.push(items);
  }
  return out.length ? out : null;
}

// Where the player stands in the game's tree. For every advancement the game shows:
//   earned    the server's log has said so (titles in earnedTitles)
//   locked    the one before it is not earned yet
//   ready     open, and the program has a way that can be taken now
//   waiting   open, with a way that cannot be taken now (why says what is missing)
//   no way    open, and nothing in the program can earn it: a request to the session
// plan(item) is the planner: a step, or { stuck: reason }. have is what the player carries.
export function survey(advancements, earnedTitles, { plan = null, have = {}, ways = WAYS } = {}) {
  const byId = new Map(advancements.map((a) => [a.id, a]));
  const earned = new Set(earnedTitles);
  // A tab's first advancement is not announced by the game. The three a player has by living
  // at all count as earned; the Nether's and the End's when anything under them is.
  const rootEarned = (a) => ['story', 'husbandry', 'adventure'].includes(a.tab) || advancements.some((b) => b.tab === a.tab && b.parent && earned.has(b.title));
  const isEarned = (a) => (a.parent === null ? rootEarned(a) : earned.has(a.title));
  const depth = (a) => { let d = 0; for (let p = a; p?.parent && d < 30; p = byId.get(p.parent)) d += 1; return d; };
  const rows = [];
  for (const a of advancements) {
    if (a.parent === null) continue;
    const row = { id: a.id, title: a.title, description: a.description, tab: a.tab, depth: depth(a), hidden: a.hidden, way: null, status: 'no way', why: null, step: null };
    const parent = byId.get(a.parent);
    const items = itemsFor(a);
    row.way = ways[a.id] ?? (items ? { items } : null);
    if (isEarned(a)) row.status = 'earned';
    else if (parent && !isEarned(parent)) { row.status = 'locked'; row.why = `after ${parent.title}`; }
    else if (row.way?.goal) { row.status = 'ready'; row.why = `the brain's goal "${row.way.goal}"`; }
    else if (row.way?.reflex) { row.status = 'ready'; row.why = `in passing: ${row.way.reflex}`; }
    else if (row.way?.items) {
      // Each group still to be had: the first of its items the planner has a step for.
      const lacking = row.way.items.filter((group) => !group.some((item) => (have[item] ?? 0) > 0));
      const stuck = [];
      for (const group of lacking) {
        const tries = plan ? group.map((item) => ({ item, step: plan(item) })) : [];
        const good = tries.find((t) => t.step && !t.step.stuck);
        if (good) { row.step ??= good.step; row.item ??= good.item; } else stuck.push(tries[0] ? `${tries[0].item}: ${tries[0].step?.stuck ?? 'no step'}` : group[0]);
      }
      if (!plan) { row.status = 'waiting'; row.why = `needs ${lacking.map((group) => group[0]).join(' and ')} (the planner is asked in the game)`; }
      else if (stuck.length) { row.status = 'waiting'; row.why = stuck.join('; '); row.step = null; }
      else { row.status = 'ready'; row.why = `needs ${lacking.map((group) => group[0]).join(' and ') || 'nothing more'}`; }
    } else row.why = `${a.criteria.map((c) => c.trigger).filter((t, i, all) => all.indexOf(t) === i).join(', ')}: nothing in the program does this`;
    rows.push(row);
  }
  const order = { ready: 0, waiting: 1, 'no way': 2, locked: 3, earned: 4 };
  rows.sort((p, q) => order[p.status] - order[q.status] || TABS.indexOf(p.tab) - TABS.indexOf(q.tab) || p.depth - q.depth || p.id.localeCompare(q.id));
  return rows;
}

// The next thing to go for that the planner can start on now: { title, item, step }, or null.
export function next(rows) {
  const row = rows.find((r) => r.status === 'ready' && r.step);
  return row ? { id: row.id, title: row.title, item: row.item, step: row.step } : null;
}

// The curriculum's requests to the session: what is open and cannot be earned by the program
// as it is, nearest the start of the game's tree first.
export function requests(rows, most = 5) {
  const effort = (r) => EFFORT[r.id]?.[0] ?? 8;
  return rows.filter((r) => (r.status === 'no way' || r.status === 'waiting') && !r.hidden)
    .sort((p, q) => effort(p) - effort(q) || p.depth - q.depth || TABS.indexOf(p.tab) - TABS.indexOf(q.tab) || p.id.localeCompare(q.id))
    .slice(0, most).map((r) => ({ title: r.title, id: r.id, asks: r.description, status: r.status, why: r.why, would: EFFORT[r.id]?.[1] ?? null }));
}

// How it stands, in a few numbers and lines, for the player's memory and for the report.
export function summary(rows) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  return { total: rows.length, earned: count('earned'), ready: count('ready'), waiting: count('waiting'), noWay: count('no way'), locked: count('locked'),
    next: next(rows)?.title ?? null, requests: requests(rows) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { load } = await import('./advancements.mjs');
  const { earnedBy } = await import('./score.mjs');
  const rows = survey(load(), earnedBy('Claude'));
  const s = summary(rows);
  console.log(`${s.earned} of ${s.total} advancements earned. Open: ${s.ready} with a way, ${s.waiting} waiting on something, ${s.noWay} with no way yet. ${s.locked} are behind those.`);
  for (const status of ['ready', 'waiting', 'no way']) {
    console.log(`\n${status}:`);
    for (const r of rows.filter((row) => row.status === status)) console.log(`  ${r.title.padEnd(34)} ${r.id.padEnd(40)} ${r.why ?? ''}`);
  }
}
