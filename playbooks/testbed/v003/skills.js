skills = {
  get_wood: {
    about: 'walk safely to the nearest visible tree and gather wood',
    options(observation, primitives) {
      const inv = (observation && observation.inventory) || {};
      if ((inv.wood || 0) >= 3) return [];
      const near = (observation && observation.nearby) || [];
      const seen = observation.here === 'tree' || near.some((c) => c.cell === 'tree');
      return seen ? [{ arg: 'tree', about: 'go to the nearest tree, avoiding pits, and collect 1 wood' }] : [];
    },
    async run(api, arg) {
      return skills._fetch(api, 'tree');
    },
  },
  get_stone: {
    about: 'walk safely to the nearest visible stone and gather it',
    options(observation, primitives) {
      const inv = (observation && observation.inventory) || {};
      if ((inv.stone || 0) >= 1) return [];
      const near = (observation && observation.nearby) || [];
      const seen = observation.here === 'stone' || near.some((c) => c.cell === 'stone');
      return seen ? [{ arg: 'stone', about: 'go to the nearest stone, avoiding pits, and collect 1 stone' }] : [];
    },
    async run(api, arg) {
      return skills._fetch(api, 'stone');
    },
  },
  craft: {
    about: 'craft an item',
    options(observation, primitives) {
      const inv = (observation && observation.inventory) || {};
      return primitives
        .filter((p) => p.name.startsWith('craft_'))
        .filter((p) => !(p.name === 'craft_table' && (inv.table || 0) >= 1))
        .map((p) => ({ arg: p.name.slice(6), about: p.about }));
    },
    async run(api, arg) {
      const prims = await api.primitives();
      if (!prims.some((p) => p.name === 'craft_' + arg)) {
        return { ok: false, note: 'cannot craft ' + arg + ' now' };
      }
      const r = await api.act('craft_' + arg);
      return r && r.ok ? 'crafted ' + arg : { ok: false, note: 'craft failed' };
    },
  },
  explore: {
    about: 'walk up to 3 cells in one direction to look for trees and stones, stopping before pits',
    options(observation, primitives) {
      const D = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
      const near = (observation && observation.nearby) || [];
      const out = [];
      for (const p of primitives) {
        const d = D[p.name];
        if (!d) continue;
        const pit = near.some((c) => c.dx === d[0] && c.dy === d[1] && c.cell === 'pit');
        if (pit) continue;
        out.push({ arg: p.name, about: 'walk ' + p.name + ' up to 3 cells, no pits' });
      }
      return out;
    },
    async run(api, arg) {
      const D = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
      const d = D[arg];
      if (!d) return { ok: false, note: 'unknown direction' };
      let moved = 0;
      for (let i = 0; i < 3; i++) {
        const obs = await api.observe();
        const near = obs.nearby || [];
        if (near.some((c) => c.dx === d[0] && c.dy === d[1] && c.cell === 'pit')) break;
        const prims = await api.primitives();
        if (!prims.some((p) => p.name === arg)) break;
        const r = await api.act(arg);
        if (!r || !r.ok) break;
        moved++;
      }
      if (moved === 0) return { ok: false, note: 'blocked going ' + arg + ', try another direction' };
      return 'walked ' + arg + ' ' + moved + ' cells';
    },
  },
};

// Helper, hidden from the menu: walk to the nearest cell of a kind, avoiding pits, then gather.
Object.defineProperty(skills, '_fetch', {
  enumerable: false,
  value: async function (api, kind) {
    const DIRS = [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]];
    for (let step = 0; step < 12; step++) {
      const obs = await api.observe();
      if (obs.here === kind) {
        const prims = await api.primitives();
        if (!prims.some((p) => p.name === 'gather')) return { ok: false, note: 'cannot gather here' };
        const r = await api.act('gather');
        return r && r.ok ? 'gathered from ' + kind : { ok: false, note: 'gather failed' };
      }
      const cells = {};
      for (const c of obs.nearby || []) cells[c.dx + ',' + c.dy] = c.cell;
      const pos = obs.pos || { x: 99, y: 99 };
      const seen = { '0,0': true };
      const queue = [[0, 0, null]];
      let first = null;
      while (queue.length) {
        const cur = queue.shift();
        if (cells[cur[0] + ',' + cur[1]] === kind) { first = cur[2]; break; }
        for (const d of DIRS) {
          const nx = cur[0] + d[1];
          const ny = cur[1] + d[2];
          const key = nx + ',' + ny;
          if (Math.abs(nx) > 2 || Math.abs(ny) > 2) continue;
          if (pos.x + nx < 0 || pos.y + ny < 0) continue;
          if (seen[key] || cells[key] === 'pit') continue;
          seen[key] = true;
          queue.push([nx, ny, cur[2] || d[0]]);
        }
      }
      if (!first) return { ok: false, note: 'no safe path to a ' + kind + ' from here, explore instead' };
      const prims = await api.primitives();
      if (!prims.some((p) => p.name === first)) return { ok: false, note: 'path blocked, explore instead' };
      const r = await api.act(first);
      if (!r || !r.ok) return { ok: false, note: 'could not move ' + first };
    }
    return { ok: false, note: 'did not reach a ' + kind };
  },
});
