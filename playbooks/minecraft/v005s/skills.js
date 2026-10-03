// Version 5s, written by hand from the stored v004 runs 22, 24, 25 and 26.
//
// What those runs showed: the road to the stone pickaxe took 7 decisions, and then the bot
// lost two decisions and about 75 seconds walking back to a table 23 blocks away, so the
// furnace came last, at decision 12 to 14 and tick 6000 to 6700.
//
// What this version changes:
//  1. Fewer, bigger jobs. One skill turns logs into a wooden pickaxe (planks, sticks, table,
//     pickaxe), instead of five decisions.
//  2. Four logs, not three. 13 planks pay for two tables, the sticks, and the wooden pickaxe.
//  3. Dig 11 cobblestone in one go (3 for the stone pickaxe, 8 for the furnace), put a second
//     table down where the stone is, and make the stone pickaxe and the furnace there. The
//     furnace no longer waits on a walk back to the first table.
//  4. Coal and iron come last. Each is one dig, and a dig that "picked nothing up" is
//     tried again and not reported as a failure, because the item is often picked up on the
//     next dig (run 22).

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

const LOGS_WANTED = 4;   // 16 planks: 13 are spent, on two tables, 4 sticks' planks and the pickaxe

function situation(observation, primitives) {
  const c = observation.carrying || {};
  const near = observation.nearest || {};
  return {
    wood: haveEnding(c, '_log') * 4 + haveEnding(c, '_planks') + (have(c, 'crafting_table') > 0 ? 4 : 0),
    logs: haveEnding(c, '_log'),
    planks: haveEnding(c, '_planks'),
    sticks: have(c, 'stick'),
    cobble: have(c, 'cobblestone'),
    coal: have(c, 'coal'),
    rawIron: have(c, 'raw_iron'),
    furnace: have(c, 'furnace') > 0,
    tableCarried: have(c, 'crafting_table') > 0,
    tableDistance: near.crafting_table,
    woodPick: have(c, 'wooden_pickaxe') > 0,
    stonePick: have(c, 'stone_pickaxe') > 0,
    logNear: firstStarting(primitives, 'collect:', '_log') !== undefined,
    stoneNear: can(primitives, 'collect:stone'),
    coalNear: can(primitives, 'collect:coal_ore'),
    ironNear: can(primitives, 'collect:iron_ore'),
  };
}

// Cobblestone still to carry: 3 for the stone pickaxe and 8 for the furnace.
function cobbleWanted(s) {
  return (s.stonePick ? 0 : 3) + (s.furnace ? 0 : 8);
}

async function attempt(api, name) {
  const result = await api.act(name);
  return result && result.ok ? null : (result && result.error) || 'it did not work';
}

// Set when the last job failed, so that exploring is offered beside the jobs.
const memory = { lastFailed: false };

function done(note) {
  memory.lastFailed = false;
  return note;
}

function failed(note) {
  memory.lastFailed = true;
  return { ok: false, note };
}

// Put a table down here if none stands within 8 blocks and one can be made or is carried.
async function tableHere(api) {
  const obs = await api.observe();
  const near = (obs.nearest || {}).crafting_table;
  if (near !== undefined && near <= 8) return;
  const c = obs.carrying || {};
  if (have(c, 'crafting_table') === 0) {
    if (haveEnding(c, '_planks') < 4 || !can(await api.primitives(), 'craft:crafting_table')) return;
    if (await attempt(api, 'craft:crafting_table')) return;
  }
  if (can(await api.primitives(), 'place:crafting_table')) await attempt(api, 'place:crafting_table');
}

const JOBS = [
  'make_stone_pickaxe', 'make_furnace', 'make_wooden_pickaxe', 'mine_stone', 'mine_coal', 'mine_iron', 'get_wood',
];

skills = {
  rest: {
    about: 'everything is done: stay where you are',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.furnace && s.coal > 0 && s.rawIron > 0 ? [{}] : [];
    },
    async run() {
      return 'the goal is reached; staying put';
    },
  },

  make_stone_pickaxe: {
    about: 'make the stone pickaxe and the furnace here, at a crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      if (s.stonePick || s.cobble < 3) return [];
      // Hold the job back until all the stone is dug, unless there is no more stone to dig.
      if (s.cobble < cobbleWanted(s) && s.stoneNear) return [];
      const tableOk = can(primitives, 'craft:stone_pickaxe') || can(primitives, 'place:crafting_table')
        || s.tableCarried || s.planks >= 4;
      return tableOk ? [{}] : [];
    },
    async run(api) {
      await tableHere(api);
      const problem = await attempt(api, 'craft:stone_pickaxe');
      if (problem) return failed(problem);
      // The furnace is made at the same table, while it is still close.
      if (can(await api.primitives(), 'craft:furnace')) {
        const trouble = await attempt(api, 'craft:furnace');
        return trouble ? done('made the stone pickaxe; the furnace did not work: ' + trouble) : done('made the stone pickaxe and the furnace');
      }
      return done('made the stone pickaxe');
    },
  },

  make_furnace: {
    about: 'craft the furnace from 8 cobblestone at a crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      if (s.furnace || s.cobble < 8 || !s.stonePick) return [];
      return can(primitives, 'craft:furnace') || can(primitives, 'place:crafting_table') || s.planks >= 4 ? [{}] : [];
    },
    async run(api) {
      if (!can(await api.primitives(), 'craft:furnace')) await tableHere(api);
      const problem = await attempt(api, 'craft:furnace');
      return problem ? failed(problem) : done('made the furnace');
    },
  },

  make_wooden_pickaxe: {
    about: 'turn the logs into planks, sticks, a crafting table and a wooden pickaxe',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      if (s.woodPick || s.stonePick) return [];
      // Logs are still to be had, so get them first: the planks pay for a second table.
      if (s.wood < 13 && s.logNear) return [];
      return s.wood >= 9 ? [{}] : [];
    },
    async run(api) {
      for (let tries = 0; tries < 6 && can(await api.primitives(), 'craft:planks'); tries++) {
        if (await attempt(api, 'craft:planks')) break;
      }
      const c = (await api.observe()).carrying || {};
      if (have(c, 'stick') < 2) {
        const problem = await attempt(api, 'craft:stick');
        if (problem) return failed('no sticks: ' + problem);
      }
      if (!can(await api.primitives(), 'craft:wooden_pickaxe')) {
        const carrying = (await api.observe()).carrying || {};
        if (have(carrying, 'crafting_table') === 0) {
          const problem = await attempt(api, 'craft:crafting_table');
          if (problem) return failed('no table: ' + problem);
        }
        if (can(await api.primitives(), 'place:crafting_table')) {
          let problem = await attempt(api, 'place:crafting_table');
          if (problem) {
            // Run 27 stood among the leaves, with no open ground. Walking to one more tree
            // moves the bot, and the log pays for the second table later.
            const log = firstStarting(await api.primitives(), 'collect:', '_log');
            if (log) await attempt(api, log.name);
            if (can(await api.primitives(), 'place:crafting_table')) problem = await attempt(api, 'place:crafting_table');
          }
          if (problem) return failed('could not place the table: ' + problem);
        }
      }
      const problem = await attempt(api, 'craft:wooden_pickaxe');
      return problem ? failed(problem) : done('made a wooden pickaxe');
    },
  },

  mine_stone: {
    about: 'dig stone with the pickaxe',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      const wanted = cobbleWanted(s);
      if (!(s.woodPick || s.stonePick) || !s.stoneNear || s.cobble >= wanted) return [];
      return [{ about: `dig stone until you carry ${wanted} cobblestone, for the stone pickaxe and the furnace` }];
    },
    async run(api) {
      const wanted = cobbleWanted(situation(await api.observe(), await api.primitives()));
      let problem = null;
      let failures = 0;
      for (let tries = 0; tries < wanted + 5 && failures < 3; tries++) {
        const c = (await api.observe()).carrying || {};
        if (have(c, 'cobblestone') >= wanted) break;
        if (!can(await api.primitives(), 'collect:stone')) { problem = 'no stone within reach'; break; }
        problem = await attempt(api, 'collect:stone');
        if (problem) failures += 1;
      }
      const got = have((await api.observe()).carrying || {}, 'cobblestone');
      return got >= wanted ? done(`now carrying ${got} cobblestone`) : failed(`only ${got} cobblestone of ${wanted}: ${problem}`);
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
      for (let tries = 0; tries < 3; tries++) {
        if (have((await api.observe()).carrying || {}, 'coal') > 0) break;
        if (!can(await api.primitives(), 'collect:coal_ore')) { problem = 'no coal ore within reach'; break; }
        problem = await attempt(api, 'collect:coal_ore');
      }
      const got = have((await api.observe()).carrying || {}, 'coal');
      return got > 0 ? done(`now carrying ${got} coal`) : failed(`no coal: ${problem}`);
    },
  },

  mine_iron: {
    about: 'dig iron ore with the stone pickaxe: this is the goal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.stonePick && s.ironNear && s.rawIron < 1 ? [{}] : [];
    },
    async run(api) {
      // A dig that picked nothing up is tried again: the drop is often picked up by the next.
      let problem = null;
      for (let tries = 0; tries < 3; tries++) {
        if (have((await api.observe()).carrying || {}, 'raw_iron') > 0) break;
        if (!can(await api.primitives(), 'collect:iron_ore')) { problem = 'no iron ore within reach'; break; }
        problem = await attempt(api, 'collect:iron_ore');
      }
      const got = have((await api.observe()).carrying || {}, 'raw_iron');
      return got > 0 ? done(`now carrying ${got} raw iron`) : failed(`no iron: ${problem}`);
    },
  },

  get_wood: {
    about: 'walk to trees and collect logs until you carry 4',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      if (s.woodPick || s.stonePick) return [];
      return s.wood < 13 && s.logNear ? [{}] : [];
    },
    async run(api) {
      let problem = null;
      let failures = 0;
      for (let tries = 0; tries < 9 && failures < 3; tries++) {
        const c = (await api.observe()).carrying || {};
        if (haveEnding(c, '_log') >= LOGS_WANTED) return done('now carrying 4 logs');
        const log = firstStarting(await api.primitives(), 'collect:', '_log');
        if (!log) { problem = 'no tree within reach'; break; }
        problem = await attempt(api, log.name);
        if (problem) failures += 1;
      }
      const got = haveEnding((await api.observe()).carrying || {}, '_log');
      return got >= LOGS_WANTED ? done('now carrying 4 logs') : got > 0 ? done(`carrying ${got} logs, then: ${problem}`) : failed(problem);
    },
  },

  explore: {
    about: 'walk about 24 blocks to look for what is missing',
    options(observation, primitives) {
      const s0 = situation(observation, primitives);
      if (s0.furnace && s0.coal > 0 && s0.rawIron > 0) return [];
      const jobHere = JOBS.some((name) => skills[name].options(observation, primitives).length > 0);
      if (jobHere && !memory.lastFailed) return [];
      return primitives
        .filter((p) => p.name.startsWith('explore:'))
        .map((p) => ({ arg: p.name.slice(8), about: p.about }));
    },
    async run(api, arg) {
      const problem = await attempt(api, 'explore:' + arg);
      memory.lastFailed = false;
      return problem ? { ok: false, note: problem } : 'walked ' + arg;
    },
  },
};
