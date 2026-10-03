// Version 3, written by hand from runs 12 and 13 (2026-10-03).
//
// What those runs showed: this model repeats one command for a whole run. With raw actions
// it dug 21 logs and crafted nothing; with a long numbered briefing it walked north 25 times.
// So each skill here is one whole job, the menu holds only jobs that are useful right now,
// most useful first, and exploring is offered only when there is nothing else to do.
//
// The plan the menu follows: 3 logs make 12 planks. 4 planks make the table, 2 make 4
// sticks, 3 planks and 2 sticks make the wooden pickaxe. 3 stone and 2 sticks make the
// stone pickaxe.

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

function situation(observation, primitives) {
  const c = observation.carrying || {};
  const near = observation.nearest || {};
  return {
    logs: haveEnding(c, '_log'),
    planks: haveEnding(c, '_planks'),
    sticks: have(c, 'stick'),
    cobble: have(c, 'cobblestone'),
    tableCarried: have(c, 'crafting_table') > 0,
    tableNear: near.crafting_table !== undefined,
    woodPick: have(c, 'wooden_pickaxe') > 0,
    stonePick: have(c, 'stone_pickaxe') > 0,
    logNear: firstStarting(primitives, 'collect:', '_log') !== undefined,
    stoneNear: can(primitives, 'collect:stone'),
  };
}

// Wood still needed, counted in planks: everything up to the wooden pickaxe takes 9.
function planksStillNeeded(s) {
  if (s.stonePick) return 0;
  let need = 0;
  if (!s.woodPick) need += 3;                     // the wooden pickaxe's head
  if (s.sticks < (s.woodPick ? 2 : 4)) need += 2; // sticks for the pickaxes still to make
  if (!s.tableCarried && !s.tableNear) need += 4; // a table, if the old one is out of sight
  return need - s.planks - s.logs * 4;
}

// Do one of the game's actions and say plainly how it went.
async function attempt(api, name) {
  const result = await api.act(name);
  return result && result.ok ? null : (result && result.error) || 'it did not work';
}

skills = {
  make_stone_pickaxe: {
    about: 'craft the stone pickaxe: this is the goal',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.stonePick && can(primitives, 'craft:stone_pickaxe') ? [{}] : [];
    },
    async run(api) {
      const problem = await attempt(api, 'craft:stone_pickaxe');
      return problem ? { ok: false, note: problem } : 'made the stone pickaxe';
    },
  },

  mine_stone: {
    about: 'dig stone with the pickaxe until you carry 3 cobblestone',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return (s.woodPick || s.stonePick) && s.cobble < 3 && s.stoneNear ? [{}] : [];
    },
    async run(api) {
      let problem = null;
      for (let tries = 0; tries < 6; tries++) {
        const c = (await api.observe()).carrying || {};
        if (have(c, 'cobblestone') >= 3) return 'now carrying 3 cobblestone';
        if (!can(await api.primitives(), 'collect:stone')) { problem = 'no stone within reach'; break; }
        problem = await attempt(api, 'collect:stone');
      }
      const got = have((await api.observe()).carrying || {}, 'cobblestone');
      return got >= 3 ? 'now carrying 3 cobblestone' : { ok: false, note: `only ${got} cobblestone: ${problem}` };
    },
  },

  make_wooden_pickaxe: {
    about: 'craft a wooden pickaxe at the crafting table',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return !s.woodPick && !s.stonePick && can(primitives, 'craft:wooden_pickaxe') ? [{}] : [];
    },
    async run(api) {
      const problem = await attempt(api, 'craft:wooden_pickaxe');
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
      if (s.tableNear || s.stonePick) return [];
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
      const problem = await attempt(api, 'place:crafting_table');
      return problem ? { ok: false, note: `carrying the table but could not place it: ${problem}` } : 'the crafting table is placed';
    },
  },

  make_planks: {
    about: 'turn the logs you carry into planks',
    options(observation, primitives) {
      const s = situation(observation, primitives);
      return s.logs > 0 && can(primitives, 'craft:planks') ? [{}] : [];
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
      return planksStillNeeded(s) > 0 && s.logNear ? [{}] : [];
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
      // Only when no job above can be done from here.
      for (const name of ['make_stone_pickaxe', 'mine_stone', 'make_wooden_pickaxe', 'make_sticks', 'make_table', 'make_planks', 'get_wood']) {
        if (skills[name].options(observation, primitives).length) return [];
      }
      return primitives
        .filter((p) => p.name.startsWith('explore:'))
        .map((p) => ({ arg: p.name.slice(8), about: p.about }));
    },
    async run(api, arg) {
      const problem = await attempt(api, 'explore:' + arg);
      return problem ? { ok: false, note: problem } : 'walked ' + arg;
    },
  },
};
