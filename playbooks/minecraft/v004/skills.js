// Version 4, written by hand from runs 18 and 20 (2026-10-03).
//
// What those runs showed: v003 gets this model to a stone pickaxe in 7 decisions, and then
// the menu has nothing left but exploring, so it walks north until the budget ends. This
// version keeps v003's road to the stone pickaxe as it was and adds what comes next: coal,
// 8 cobblestone, a furnace, then iron ore. One fix on that road: see tableNear below.
//
// After the stone pickaxe the menu is longer than before. Exploring is offered beside the
// jobs that can be done here whenever no iron ore is in sight, so the model has a real
// choice to make, and the briefing tells it how to make it.
//
// The plan the menu follows: 3 logs make 12 planks. 4 planks make the table, 2 make 4
// sticks, 3 planks and 2 sticks make the wooden pickaxe. 3 stone and 2 sticks make the
// stone pickaxe. 8 stone make the furnace, at the table. Iron ore needs the stone pickaxe.

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

function firstStarting(primitives, start, ending) {
  return primitives.find((p) => p.name.startsWith(start) && (!ending || p.name.endsWith(ending)));
}

// The game offers these only when a crafting table stands close by.
const NEEDS_TABLE = [
  'craft:wooden_pickaxe', 'craft:wooden_axe', 'craft:wooden_sword',
  'craft:stone_pickaxe', 'craft:stone_axe', 'craft:stone_sword', 'craft:furnace',
];

function situation(observation, primitives) {
  const c = observation.carrying || {};
  const near = observation.nearest || {};
  const tableCarried = have(c, 'crafting_table') > 0;
  return {
    logs: haveEnding(c, '_log'),
    planks: haveEnding(c, '_planks'),
    sticks: have(c, 'stick'),
    cobble: have(c, 'cobblestone'),
    coal: have(c, 'coal'),
    rawIron: have(c, 'raw_iron'),
    furnace: have(c, 'furnace') > 0,
    tableCarried,
    // The list of what is near can leave a table out when there is a lot of stone about.
    // Two other signs of a table close by: the game offers to craft something that needs
    // one, or it refuses to place a carried table. Run 20 crafted a second table and then
    // chose make_table again, because the first one had dropped off the list.
    tableNear: near.crafting_table !== undefined
      || primitives.some((p) => NEEDS_TABLE.includes(p.name))
      || (tableCarried && !can(primitives, 'place:crafting_table')),
    woodPick: have(c, 'wooden_pickaxe') > 0,
    stonePick: have(c, 'stone_pickaxe') > 0,
    logNear: firstStarting(primitives, 'collect:', '_log') !== undefined,
    stoneNear: can(primitives, 'collect:stone'),
    coalNear: can(primitives, 'collect:coal_ore'),
    ironNear: can(primitives, 'collect:iron_ore'),
  };
}

// Cobblestone to carry: 3 for the stone pickaxe, then 8 for the furnace, then none.
function cobbleWanted(s) {
  if (!s.stonePick) return 3;
  return s.furnace ? 0 : 8;
}

// Planks still to be spent. Up to the wooden pickaxe that is 9; after the stone pickaxe it
// is only a new table, when the furnace is not made and the old table is out of sight.
function planksWanted(s) {
  let need = 0;
  if (!s.stonePick) {
    if (!s.woodPick) need += 3;                     // the wooden pickaxe's head
    if (s.sticks < (s.woodPick ? 2 : 4)) need += 2; // sticks for the pickaxes still to make
  }
  if (!s.furnace && !s.tableCarried && !s.tableNear) need += 4;
  return need;
}

// Do one of the game's actions and say plainly how it went.
async function attempt(api, name) {
  const result = await api.act(name);
  return result && result.ok ? null : (result && result.error) || 'it did not work';
}

// The one thing remembered between decisions, for one run: the last craft at the table
// failed because the table could not be walked to. Run 20 chose make_stone_pickaxe four times
// running, up to 30 seconds a time, with the table 24 blocks off and uphill. While this is set,
// crafts that need the table are hidden and exploring is offered: a walk either brings the
// table within reach or leaves it far enough behind for a new one to be placed.
const memory = { tableOutOfReach: false };

async function craftAtTable(api, item) {
  const problem = await attempt(api, 'craft:' + item);
  memory.tableOutOfReach = problem !== null && /crafting table|path to goal/.test(problem);
  return problem;
}

// The jobs that can be done without walking off. Exploring looks at these.
const JOBS = [
  'make_stone_pickaxe', 'make_furnace', 'mine_iron', 'mine_coal', 'mine_stone',
  'make_wooden_pickaxe', 'make_sticks', 'make_table', 'make_planks', 'get_wood',
];

skills = {
  make_stone_pickaxe: {
    about: 'craft the stone pickaxe at the crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.stonePick && can(primitives, 'craft:stone_pickaxe') && !memory.tableOutOfReach ? [{}] : [];
    },
    async run(api) {
      const problem = await craftAtTable(api, 'stone_pickaxe');
      return problem ? { ok: false, note: problem } : 'made the stone pickaxe';
    },
  },

  make_furnace: {
    about: 'craft the furnace from 8 cobblestone at the crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.furnace && can(primitives, 'craft:furnace') && !memory.tableOutOfReach ? [{}] : [];
    },
    async run(api) {
      const problem = await craftAtTable(api, 'furnace');
      return problem ? { ok: false, note: problem } : 'made the furnace';
    },
  },

  mine_iron: {
    about: 'dig iron ore with the stone pickaxe: this is the goal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.stonePick && s.ironNear && s.rawIron < 3 ? [{}] : [];
    },
    async run(api) {
      // Stop at the first failure. Ore dug with the wrong tool is gone and drops nothing.
      let problem = null;
      for (let tries = 0; tries < 4; tries++) {
        const c = (await api.observe()).carrying || {};
        if (have(c, 'raw_iron') >= 3) break;
        if (!can(await api.primitives(), 'collect:iron_ore')) { problem = 'no iron ore within reach'; break; }
        problem = await attempt(api, 'collect:iron_ore');
        if (problem) break;
      }
      const got = have((await api.observe()).carrying || {}, 'raw_iron');
      return got > 0 ? `now carrying ${got} raw iron` : { ok: false, note: `no iron: ${problem}` };
    },
  },

  mine_coal: {
    about: 'dig coal ore with the pickaxe to get coal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.stonePick && s.coalNear && s.coal < 1 ? [{}] : [];
    },
    async run(api) {
      let problem = null;
      for (let tries = 0; tries < 2; tries++) {
        if (!can(await api.primitives(), 'collect:coal_ore')) { problem = 'no coal ore within reach'; break; }
        problem = await attempt(api, 'collect:coal_ore');
        if (!problem) break;
      }
      const got = have((await api.observe()).carrying || {}, 'coal');
      return got > 0 ? `now carrying ${got} coal` : { ok: false, note: `no coal: ${problem}` };
    },
  },

  mine_stone: {
    about: 'dig stone with the pickaxe',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const wanted = cobbleWanted(s);
      if (!(s.woodPick || s.stonePick) || !s.stoneNear || s.cobble >= wanted) return [];
      return [{ about: `dig stone with the pickaxe until you carry ${wanted} cobblestone${wanted === 8 ? ', for the furnace' : ''}` }];
    },
    async run(api) {
      const first = await api.observe();
      const wanted = cobbleWanted(situation(first, await api.primitives()));
      let problem = null;
      let failures = 0;
      for (let tries = 0; tries < wanted + 4 && failures < 3; tries++) {
        const c = (await api.observe()).carrying || {};
        if (have(c, 'cobblestone') >= wanted) break;
        if (!can(await api.primitives(), 'collect:stone')) { problem = 'no stone within reach'; break; }
        problem = await attempt(api, 'collect:stone');
        if (problem) failures += 1;
      }
      const got = have((await api.observe()).carrying || {}, 'cobblestone');
      return got >= wanted ? `now carrying ${got} cobblestone` : { ok: false, note: `only ${got} cobblestone of ${wanted}: ${problem}` };
    },
  },

  make_wooden_pickaxe: {
    about: 'craft a wooden pickaxe at the crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.woodPick && !s.stonePick && can(primitives, 'craft:wooden_pickaxe') && !memory.tableOutOfReach ? [{}] : [];
    },
    async run(api) {
      const problem = await craftAtTable(api, 'wooden_pickaxe');
      return problem ? { ok: false, note: problem } : 'made a wooden pickaxe';
    },
  },

  make_sticks: {
    about: 'craft 4 sticks from 2 planks',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.stonePick && s.sticks < 2 && can(primitives, 'craft:stick') ? [{}] : [];
    },
    async run(api) {
      const problem = await attempt(api, 'craft:stick');
      return problem ? { ok: false, note: problem } : 'made 4 sticks';
    },
  },

  make_table: {
    about: 'craft a crafting table from 4 planks and put it on the ground',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      // No table is needed once the furnace is made.
      if (s.tableNear || s.furnace) return [];
      return s.tableCarried || can(primitives, 'craft:crafting_table') ? [{}] : [];
    },
    async run(api) {
      // Craft one only if none is carried. Run 14 crafted a second table here while the
      // first could not be placed, and spent the planks the pickaxe needed.
      const carrying = (await api.observe()).carrying || {};
      if (have(carrying, 'crafting_table') === 0) {
        const problem = await attempt(api, 'craft:crafting_table');
        if (problem) return { ok: false, note: problem };
      }
      if (!can(await api.primitives(), 'place:crafting_table')) return 'a crafting table already stands close by';
      const problem = await attempt(api, 'place:crafting_table');
      return problem ? { ok: false, note: `carrying the table but could not place it: ${problem}` } : 'the crafting table is placed';
    },
  },

  make_planks: {
    about: 'turn the logs you carry into planks',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.logs > 0 && planksWanted(s) > s.planks && can(primitives, 'craft:planks') ? [{}] : [];
    },
    async run(api) {
      let made = 0;
      for (let tries = 0; tries < 4 && can(await api.primitives(), 'craft:planks'); tries++) {
        if (await attempt(api, 'craft:planks')) break;
        made += 4;
      }
      return made ? `made ${made} planks` : { ok: false, note: 'could not make planks' };
    },
  },

  get_wood: {
    about: 'walk to trees and collect logs until you carry 3',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return planksWanted(s) - s.planks - s.logs * 4 > 0 && s.logNear ? [{}] : [];
    },
    async run(api) {
      let problem = null;
      let failures = 0;
      for (let tries = 0; tries < 8 && failures < 3; tries++) {
        const c = (await api.observe()).carrying || {};
        if (haveEnding(c, '_log') >= 3) return 'now carrying 3 logs';
        const log = firstStarting(await api.primitives(), 'collect:', '_log');
        if (!log) { problem = 'no tree within reach'; break; }
        problem = await attempt(api, log.name);
        if (problem) failures += 1;
      }
      const got = haveEnding((await api.observe()).carrying || {}, '_log');
      return got >= 3 ? 'now carrying 3 logs' : got > 0 ? `carrying ${got} logs, then: ${problem}` : { ok: false, note: problem };
    },
  },

  explore: {
    about: 'walk about 24 blocks to look for what is missing',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      // Offered when no job can be done from here, and also beside the jobs once the stone
      // pickaxe is made and no iron ore is in sight: iron has to be looked for.
      const lookingForIron = s.stonePick && !s.ironNear && s.rawIron < 3;
      const jobHere = JOBS.some((name) => skills[name].options(observation, primitives).length > 0);
      if (jobHere && !lookingForIron && !memory.tableOutOfReach) return [];
      return primitives
        .filter((p) => p.name.startsWith('explore:'))
        .map((p) => ({ arg: p.name.slice(8), about: p.about + (lookingForIron ? ' to look for iron ore' : '') }));
    },
    async run(api, arg) {
      const problem = await attempt(api, 'explore:' + arg);
      // One walk, then the table is tried again, whether the walk got anywhere or not.
      memory.tableOutOfReach = false;
      return problem ? { ok: false, note: problem } : 'walked ' + arg;
    },
  },
};
