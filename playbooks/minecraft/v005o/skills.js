// Version 5o, written by hand from the v004 runs 22, 24, 25 and 26 (2026-10-03), then
// changed once after its own first run, 28.
//
// What the v004 runs showed, and what this version does about it:
//
// 1. Every run lost about 75 seconds and two decisions at the furnace. The bot had mined
//    down for iron, and craft:furnace walked to the old crafting table, 19 or more blocks
//    off and far above, until it timed out. Run 26 never made the furnace at all: once the
//    old table was more than 32 blocks off, nothing on the menu could make one. Now every
//    craft that needs a table first puts one down where the bot stands when no table is
//    within 8 blocks (tableHere below). That needs wood, so get_wood collects 5 logs at the
//    start, not 3: enough for the first table, the sticks, the wooden pickaxe, and one
//    spare table each for the stone pickaxe and the furnace. (The table was 10 to 12
//    blocks off at the stone pickaxe in 3 of 5 runs, and 9 to 26 off at the furnace.)
// 2. Run 22 walked 26 seconds back up to its table to make the stone pickaxe, run 24 16
//    seconds. The same rule places a new table there when the old one is beyond 8 blocks.
// 3. mine_iron dug until it carried 3 raw iron: 58 seconds, and two decisions in runs 22,
//    24 and 25. One raw iron is the milestone, so it stops at the first.
// 4. Planks, sticks and the table each took a decision of their own. A craft now makes the
//    planks, sticks and table it needs on the way, so the road to the wooden pickaxe is two
//    decisions (get_wood, make_wooden_pickaxe) instead of five.
// 5. The stone pickaxe makes its own sticks when they are missing (run 24 spent a decision
//    on make_sticks; see 8 for why they seemed to be missing).
// 6. Planks only combine with planks of the same wood (the recipes are per wood type), so
//    get_wood keeps to one kind of tree while that kind is in reach.
// 7. After the goal, v004 offered only exploring, which can fail or walk into danger. Now
//    rest is offered, which does nothing: there is nothing further this game can do yet.
//
// After run 28 (this version's first run: all 11 milestones by decision 9, tick 4838):
//
// 8. What the game reports as carried goes stale. After make_wooden_pickaxe, 3 logs were
//    missing from it; one dig later they were back (4 logs after digging 1). Run 24's
//    "lost" sticks were the same thing: 2 vanished, and 6 were carried after making 4.
//    Run 28 believed the wood was short and offered get_wood beside mine_stone, and the
//    model took it: a decision and 9 seconds. So after the first pickaxe, get_wood is
//    offered only when no other job can be done.
// 9. Every observe() or primitives() call costs about a second (the game searches for
//    blocks each time), and the skills made two or three for every action. They now read
//    what they need from the results of the actions themselves: an action that is not
//    possible is refused with nothing done, which is the cheapest test there is.
//
// The menu order is the order of the skills below: the most useful job first.

function have(carrying, name) {
  return (carrying && carrying[name]) || 0;
}

function haveEnding(carrying, ending) {
  let total = 0;
  for (const name of Object.keys(carrying || {})) if (name.endsWith(ending)) total += carrying[name];
  return total;
}

function can(primitives, name) {
  return primitives.some((p) => p.name === name);
}

// The game offers these only when a crafting table is within 32 blocks.
const NEEDS_TABLE = [
  'craft:wooden_pickaxe', 'craft:wooden_axe', 'craft:wooden_sword',
  'craft:stone_pickaxe', 'craft:stone_axe', 'craft:stone_sword', 'craft:furnace',
];

function situation(observation, primitives) {
  const c = observation.carrying || {};
  const near = observation.nearest || {};
  const logs = haveEnding(c, '_log');
  const planks = haveEnding(c, '_planks');
  const tableCarried = have(c, 'crafting_table') > 0;
  const tableDistance = near.crafting_table;
  return {
    logs,
    planks,
    wood: planks + 4 * logs,           // in planks: a log makes 4
    sticks: have(c, 'stick'),
    cobble: have(c, 'cobblestone'),
    coal: have(c, 'coal'),
    iron: have(c, 'raw_iron'),
    furnace: have(c, 'furnace') > 0,
    woodPick: have(c, 'wooden_pickaxe') > 0,
    stonePick: have(c, 'stone_pickaxe') > 0,
    tableCarried,
    // A table near enough to use. The game will not place a carried table within 8 blocks
    // of another, so a carried table it refuses to place is also one near enough.
    tableClose: (tableDistance !== undefined && tableDistance <= 8)
      || (tableCarried && !can(primitives, 'place:crafting_table')),
    // A table a craft could walk to: the game's crafts use the nearest within 32 blocks.
    tableAnywhere: tableDistance !== undefined || primitives.some((p) => NEEDS_TABLE.includes(p.name)),
    logNear: primitives.some((p) => p.name.startsWith('collect:') && p.name.endsWith('_log')),
    stoneNear: can(primitives, 'collect:stone'),
    coalNear: can(primitives, 'collect:coal_ore'),
    ironNear: can(primitives, 'collect:iron_ore'),
  };
}

const done = (s) => s.furnace && s.iron > 0 && s.coal > 0;

// Wood still to be spent, in planks: 2 for 4 sticks, 3 for the wooden pickaxe's head, and 4
// for each table still to put down (the first, then a spare for the stone pickaxe and one
// for the furnace, since both are usually made far from the first table).
function woodWanted(s) {
  let need = 0;
  const sticksWanted = (!s.woodPick && !s.stonePick ? 2 : 0) + (!s.stonePick ? 2 : 0);
  if (s.sticks < sticksWanted) need += 2 * Math.ceil((sticksWanted - s.sticks) / 4);
  if (!s.woodPick && !s.stonePick) need += 3;
  if (!s.furnace) {
    let tables = (!s.stonePick ? 1 : 0) + 1;
    if (!s.woodPick && !s.stonePick && !s.tableClose) tables += 1;
    if (s.tableCarried) tables -= 1;
    need += 4 * Math.max(0, tables);
  }
  return need;
}

// Cobblestone to carry: 3 for the stone pickaxe, then 8 for the furnace, then none.
function cobbleWanted(s) {
  if (!s.stonePick) return 3;
  return s.furnace ? 0 : 8;
}

// The one thing remembered between decisions: the skill whose last try failed. It is left
// off the next menu, so the model cannot pick it again straight away (the briefing asks
// the same, but a menu that cannot offer it is surer).
const memory = { failed: null };

function settle(name, out) {
  memory.failed = out && typeof out === 'object' && out.ok === false ? name : null;
  return out;
}

// The game refuses an action that is not possible now, and does nothing.
const refused = (result) => !result || (result.ok === false && /is not possible now/.test(result.error || ''));
const reason = (result) => (result && result.error) || 'it did not work';
const gained = (result, item) => (result && result.ok && result.got && result.got[item]) || 0;

// Do a craft, turning one more log into planks each time the game refuses it. Planks of two
// woods do not combine, so one more log may be needed even when the count looks enough.
async function craftWithPlanks(api, name) {
  for (let i = 0; i < 5; i++) {
    const result = await api.act(name);
    if (result && result.ok) return null;
    if (!refused(result)) return reason(result);
    const planks = await api.act('craft:planks');
    if (!(planks && planks.ok)) return `cannot ${name} with what is carried`;
  }
  return `cannot ${name} with what is carried`;
}

// Make sure a crafting table stands within 8 blocks: put one down here if not, crafting it
// first when none is carried. Returns { placed, problem }.
async function tableHere(api, observation) {
  const near = observation.nearest || {};
  if (near.crafting_table !== undefined && near.crafting_table <= 8) return { placed: false, problem: null };
  if (!have(observation.carrying, 'crafting_table')) {
    const problem = await craftWithPlanks(api, 'craft:crafting_table');
    if (problem) return { placed: false, problem: `no new table: ${problem}` };
  }
  const result = await api.act('place:crafting_table');
  if (result && result.ok) return { placed: true, problem: null };
  // Refused: a table stands within 8 blocks after all, and the one carried is kept.
  return { placed: false, problem: refused(result) ? null : `could not place a table: ${reason(result)}` };
}

// Make an item that needs the table: its sticks, then a table here if none is close, then
// the item. If no table could be put down, the craft still walks to one within 32 blocks.
async function craftAtTable(api, item, sticksNeeded) {
  const observation = await api.observe();
  if (sticksNeeded && have(observation.carrying, 'stick') < sticksNeeded) {
    const problem = await craftWithPlanks(api, 'craft:stick');
    if (problem) return { ok: false, note: `no sticks: ${problem}` };
  }
  const table = await tableHere(api, observation);
  let problem;
  if (item.startsWith('wooden_')) problem = await craftWithPlanks(api, 'craft:' + item);
  else {
    const result = await api.act('craft:' + item);
    problem = result && result.ok ? null : reason(result);
  }
  if (problem) return { ok: false, note: table.problem ? `${problem}; ${table.problem}` : problem };
  // Run 31 crafted a new table 15 blocks below the old one, did not put it down, and walked
  // 30 seconds to the old one; its note did not say why. Now the note says.
  return `made the ${item}${table.placed ? ' at a new crafting table put down here' : ''}${table.problem ? ` (${table.problem})` : ''}`;
}

// Dig one kind of block until `wanted` of `item` are carried, counting from what each dig
// picks up. Stops after 3 failures, or when the game refuses because none is in reach.
async function digUntil(api, block, item, wanted, tries) {
  let count = have((await api.observe()).carrying, item);
  let problem = null;
  let failures = 0;
  for (let i = 0; i < tries && failures < 3 && count < wanted; i++) {
    const result = await api.act('collect:' + block);
    if (refused(result)) { problem = `no ${block} within reach`; break; }
    count += gained(result, item);
    // A dig that worked but brought none of the item (the drop fell out of reach) counts
    // as a failure too: run 22 dug iron ore and picked nothing up.
    if (!gained(result, item)) { failures += 1; problem = result && result.ok ? `dug the ${block} but got no ${item}` : reason(result); }
  }
  return { count, problem };
}

// The jobs, in the order the menu lists them. Exploring is offered only when none applies.
const JOBS = [
  'make_furnace', 'make_stone_pickaxe', 'mine_iron', 'mine_coal', 'mine_stone',
  'make_wooden_pickaxe', 'get_wood',
];

function offer(name, ok, about) {
  if (!ok || memory.failed === name) return [];
  return [about ? { about } : {}];
}

skills = {
  rest: {
    about: 'the goal is reached: stay here and keep safe',
    options(observation, primitives) {
      return done(situation(observation, primitives)) ? [{}] : [];
    },
    async run() {
      return 'rested: iron, coal and the furnace are all carried';
    },
  },

  make_furnace: {
    about: 'craft the furnace from 8 cobblestone, putting a crafting table down here if none is close',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return offer('make_furnace', !s.furnace && s.stonePick && s.cobble >= 8
        && (s.tableClose || s.tableCarried || s.wood >= 4 || can(primitives, 'craft:furnace')));
    },
    async run(api) {
      return settle('make_furnace', await craftAtTable(api, 'furnace', 0));
    },
  },

  make_stone_pickaxe: {
    about: 'craft the stone pickaxe, with sticks and a crafting table here if needed',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const sticksOk = s.sticks >= 2 || s.wood >= 2;
      const tableOk = s.tableClose || s.tableCarried || s.tableAnywhere || s.wood >= (s.sticks >= 2 ? 4 : 6);
      return offer('make_stone_pickaxe', !s.stonePick && s.cobble >= 3
        && (can(primitives, 'craft:stone_pickaxe') || (sticksOk && tableOk)));
    },
    async run(api) {
      return settle('make_stone_pickaxe', await craftAtTable(api, 'stone_pickaxe', 2));
    },
  },

  mine_iron: {
    about: 'dig iron ore with the stone pickaxe: this is the goal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return offer('mine_iron', s.stonePick && s.ironNear && s.iron < 1);
    },
    async run(api) {
      // One raw iron is the goal; up to 3 ores are tried for it.
      const { count, problem } = await digUntil(api, 'iron_ore', 'raw_iron', 1, 3);
      return settle('mine_iron', count > 0 ? `now carrying ${count} raw iron` : { ok: false, note: `no iron: ${problem}` });
    },
  },

  mine_coal: {
    about: 'dig coal ore with the pickaxe to get coal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return offer('mine_coal', s.stonePick && s.coalNear && s.coal < 1);
    },
    async run(api) {
      const { count, problem } = await digUntil(api, 'coal_ore', 'coal', 1, 3);
      return settle('mine_coal', count > 0 ? `now carrying ${count} coal` : { ok: false, note: `no coal: ${problem}` });
    },
  },

  mine_stone: {
    about: 'dig stone with the pickaxe',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const wanted = cobbleWanted(s);
      return offer('mine_stone', (s.woodPick || s.stonePick) && s.stoneNear && s.cobble < wanted,
        `dig stone until you carry ${wanted} cobblestone${wanted === 8 ? ', for the furnace' : ''}`);
    },
    async run(api) {
      const wanted = cobbleWanted(situation(await api.observe(), await api.primitives()));
      const { count, problem } = await digUntil(api, 'stone', 'cobblestone', wanted, wanted + 4);
      return settle('mine_stone', count >= wanted ? `now carrying ${count} cobblestone` : { ok: false, note: `only ${count} cobblestone of ${wanted}: ${problem}` });
    },
  },

  make_wooden_pickaxe: {
    about: 'make planks, sticks and a crafting table, then a wooden pickaxe',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const tableOk = s.tableClose || s.tableCarried || s.tableAnywhere;
      const woodNeeded = 3 + (s.sticks >= 2 ? 0 : 2) + (tableOk ? 0 : 4);
      return offer('make_wooden_pickaxe', !s.woodPick && !s.stonePick
        && (can(primitives, 'craft:wooden_pickaxe') || s.wood >= woodNeeded));
    },
    async run(api) {
      return settle('make_wooden_pickaxe', await craftAtTable(api, 'wooden_pickaxe', 2));
    },
  },

  get_wood: {
    about: 'walk to trees and collect logs',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const logsToGet = Math.ceil((woodWanted(s) - s.wood) / 4);
      if (!s.logNear || logsToGet <= 0) return [];
      // Before the first pickaxe this is the first job. After it, what is carried can read
      // short when it is not (see 8 above), so it waits until nothing else can be done.
      if (s.woodPick || s.stonePick) {
        const other = JOBS.some((name) => name !== 'get_wood' && skills[name].options(observation, primitives).length > 0);
        if (other) return [];
      }
      return offer('get_wood', true, `walk to trees and collect ${logsToGet} more logs`);
    },
    async run(api) {
      const observation = await api.observe();
      const first = situation(observation, await api.primitives());
      const target = first.logs + Math.ceil((woodWanted(first) - first.wood) / 4);
      // Keep to the kind of log already carried while one is in reach: planks of two woods
      // do not combine in a recipe. With none carried, the nearest kind.
      const c = observation.carrying || {};
      const carriedKinds = Object.keys(c).filter((n) => n.endsWith('_log')).sort((a, b) => c[b] - c[a]);
      let kind = carriedKinds[0] || null;
      let logs = first.logs;
      let problem = null;
      let failures = 0;
      for (let tries = 0; tries < 10 && failures < 3 && logs < target; tries++) {
        let result = kind ? await api.act('collect:' + kind) : null;
        if (refused(result)) {
          const offered = (await api.primitives()).filter((p) => p.name.startsWith('collect:') && p.name.endsWith('_log'));
          if (!offered.length) { problem = 'no tree within reach'; break; }
          kind = offered[0].name.slice('collect:'.length);
          result = await api.act('collect:' + kind);
        }
        const got = Object.entries((result && result.ok && result.got) || {})
          .filter(([name]) => name.endsWith('_log')).reduce((sum, [, n]) => sum + n, 0);
        logs += got;
        if (!got) { failures += 1; problem = reason(result); }
      }
      if (logs >= target) return settle('get_wood', `now carrying ${logs} logs`);
      return settle('get_wood', logs > first.logs ? `carrying ${logs} logs of ${target}, then: ${problem}` : { ok: false, note: problem || 'no logs' });
    },
  },

  explore: {
    about: 'walk about 24 blocks to look for what is missing',
    options(observation, primitives) {
      if (done(situation(observation, primitives))) return [];
      const jobHere = JOBS.some((name) => skills[name].options(observation, primitives).length > 0);
      if (jobHere) return [];
      return primitives.filter((p) => p.name.startsWith('explore:')).map((p) => ({ arg: p.name.slice(8), about: p.about }));
    },
    async run(api, arg) {
      const result = await api.act('explore:' + arg);
      return settle('explore', result && result.ok ? 'walked ' + arg : { ok: false, note: reason(result) });
    },
  },
};
