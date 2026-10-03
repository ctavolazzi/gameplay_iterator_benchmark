function countEnding(carrying, suffix) {
  let n = 0;
  for (const k in carrying) if (k.endsWith(suffix)) n += carrying[k];
  return n;
}
function state(observation) {
  const c = (observation && observation.carrying) || {};
  const near = (observation && observation.nearest) || {};
  const logs = countEnding(c, '_log');
  const planks = countEnding(c, '_planks');
  const sticks = c.stick || 0;
  const stonePick = (c.stone_pickaxe || 0) > 0;
  const woodPick = (c.wooden_pickaxe || 0) > 0;
  const tableCarried = (c.crafting_table || 0) > 0;
  const tableNear = near.crafting_table !== undefined && near.crafting_table <= 24;
  const cobble = c.cobblestone || 0;
  return { c, near, logs, planks, sticks, stonePick, woodPick, anyPick: stonePick || woodPick, tableCarried, tableNear, cobble };
}
function woodNeeded(s) {
  if (s.stonePick) return 0;
  let need = 0;
  if (!s.anyPick) {
    need += 3;
    if (!s.tableCarried && !s.tableNear) need += 4;
    if (s.sticks < 2) need += 2;
  } else {
    if (s.sticks < 2) need += 2;
    if (!s.tableCarried && !s.tableNear) need += 4;
  }
  return Math.max(0, need - (s.logs * 4 + s.planks));
}

skills = {
  make: {
    about: 'craft the next useful item from what you carry (do this before gathering)',
    options(observation, primitives) {
      const s = state(observation);
      const can = {};
      for (const p of primitives) if (p.name.startsWith('craft:')) can[p.name.slice(6)] = true;
      const out = [];
      if (can.stone_pickaxe && !s.stonePick) out.push({ arg: 'stone_pickaxe', about: 'make the stone pickaxe: the main goal' });
      if (can.wooden_pickaxe && !s.anyPick) out.push({ arg: 'wooden_pickaxe', about: 'make a wooden pickaxe so you can mine stone' });
      if (can.crafting_table && !s.tableCarried && !s.tableNear) out.push({ arg: 'crafting_table', about: 'make a crafting table from 4 planks' });
      if (can.stick && s.sticks < 2 && !s.stonePick) out.push({ arg: 'stick', about: 'make sticks from 2 planks' });
      if (can.planks && s.planks < 6 && !s.stonePick) out.push({ arg: 'planks', about: 'turn 1 log into 4 planks' });
      if (s.stonePick) {
        if (can.stone_sword && !s.c.stone_sword) out.push({ arg: 'stone_sword', about: 'make a sword to fight monsters' });
        if (can.furnace && !s.c.furnace) out.push({ arg: 'furnace', about: 'make a furnace from 8 cobblestone' });
      }
      return out.slice(0, 3);
    },
    async run(api, arg) {
      const prims = await api.primitives();
      const name = 'craft:' + arg;
      if (!prims.some((p) => p.name === name)) return { ok: false, note: 'cannot craft ' + arg + ' right now' };
      const r = await api.act(name);
      if (!r || !r.ok) return { ok: false, note: 'crafting ' + arg + ' failed' };
      return 'made ' + arg;
    },
  },
  place: {
    about: 'put the carried crafting table on the ground so tools can be made',
    options(observation, primitives) {
      return primitives
        .filter((p) => p.name === 'place:crafting_table')
        .map(() => ({ arg: 'crafting_table', about: 'place the crafting table here' }));
    },
    async run(api, arg) {
      const prims = await api.primitives();
      if (!prims.some((p) => p.name === 'place:crafting_table')) return { ok: false, note: 'no crafting table to place' };
      const r = await api.act('place:crafting_table');
      if (!r || !r.ok) return { ok: false, note: 'placing failed' };
      return 'crafting table placed';
    },
  },
  mine: {
    about: 'dig up to 3 blocks with the pickaxe',
    options(observation, primitives) {
      const s = state(observation);
      if (!s.anyPick) return [];
      const can = {};
      for (const p of primitives) if (p.name.startsWith('collect:')) can[p.name.slice(8)] = true;
      const out = [];
      if (can.stone && (!s.stonePick ? s.cobble < 3 : s.cobble < 11)) out.push({ arg: 'stone', about: 'mine 3 stone (cobblestone for the stone pickaxe)' });
      if (can.coal_ore && s.stonePick) out.push({ arg: 'coal_ore', about: 'mine coal for torches' });
      if (can.iron_ore && s.stonePick) out.push({ arg: 'iron_ore', about: 'mine iron ore' });
      return out.slice(0, 2);
    },
    async run(api, arg) {
      const name = 'collect:' + arg;
      let got = 0;
      let fails = 0;
      for (let i = 0; i < 6 && got < 3 && fails < 2; i++) {
        const prims = await api.primitives();
        if (!prims.some((p) => p.name === name)) break;
        const r = await api.act(name);
        if (r && r.ok) got++;
        else fails++;
        const o = await api.observe();
        if (o.health <= 8) break;
      }
      if (got === 0) return { ok: false, note: 'could not mine ' + arg };
      return 'mined ' + got + ' ' + arg;
    },
  },
  wood: {
    about: 'collect up to 3 logs from the nearest tree (only while wood is still needed)',
    options(observation, primitives) {
      const s = state(observation);
      if (woodNeeded(s) <= 0) return [];
      const logs = primitives
        .filter((p) => p.name.startsWith('collect:') && p.name.endsWith('_log'))
        .map((p) => p.name.slice(8));
      if (logs.length === 0) return [];
      logs.sort((a, b) => (s.near[a] === undefined ? 99 : s.near[a]) - (s.near[b] === undefined ? 99 : s.near[b]));
      return [{ arg: logs[0], about: 'collect 3 ' + logs[0] + ' for planks' }];
    },
    async run(api, arg) {
      const start = countEnding((await api.observe()).carrying || {}, '_log');
      let have = start;
      let fails = 0;
      for (let i = 0; i < 7 && have - start < 3 && fails < 3; i++) {
        const prims = await api.primitives();
        let name = 'collect:' + arg;
        if (!prims.some((p) => p.name === name)) {
          const other = prims.find((p) => p.name.startsWith('collect:') && p.name.endsWith('_log'));
          if (!other) break;
          name = other.name;
        }
        const r = await api.act(name);
        if (!r || !r.ok) fails++;
        const o = await api.observe();
        have = countEnding(o.carrying || {}, '_log');
        if (o.health <= 8) break;
      }
      const got = have - start;
      if (got <= 0) return { ok: false, note: 'could not collect any logs' };
      return 'collected ' + got + ' logs, now carrying ' + have + '; craft planks next';
    },
  },
  explore: {
    about: 'walk about 24 blocks to find trees or stone, or to get away from monsters',
    options(observation, primitives) {
      const s = state(observation);
      const dirs = primitives.filter((p) => p.name.startsWith('explore:')).map((p) => p.name.slice(8));
      const noLogs = !Object.keys(s.near).some((k) => k.endsWith('_log'));
      const stuck = (woodNeeded(s) > 0 && noLogs) || (s.anyPick && s.near.stone === undefined);
      const monsters = observation && observation.monsters && Object.keys(observation.monsters).length > 0;
      const list = stuck || monsters ? dirs : dirs.slice(0, 2);
      return list.map((d) => ({ arg: d, about: 'walk ' + d }));
    },
    async run(api, arg) {
      const prims = await api.primitives();
      const name = 'explore:' + arg;
      if (!prims.some((p) => p.name === name)) return { ok: false, note: 'cannot explore ' + arg };
      const r = await api.act(name);
      if (!r || !r.ok) return { ok: false, note: 'exploring ' + arg + ' failed' };
      return 'walked ' + arg;
    },
  },
};
