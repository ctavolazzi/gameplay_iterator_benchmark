skills = {
  get: {
    about: 'walk safely to the nearest tree or stone and gather it',
    plan(obs, kind, blocked) {
      blocked = blocked || {};
      const pos = obs.pos || { x: 0, y: 0 };
      const cells = {};
      for (const c of obs.nearby || []) cells[c.dx + ',' + c.dy] = c.cell;
      if (obs.here === kind) return { dir: 'here', dist: 0 };
      const dirs = [
        { n: 'north', dx: 0, dy: -1 },
        { n: 'south', dx: 0, dy: 1 },
        { n: 'east', dx: 1, dy: 0 },
        { n: 'west', dx: -1, dy: 0 },
      ];
      const seen = { '0,0': true };
      const queue = [{ dx: 0, dy: 0, first: null, dist: 0 }];
      while (queue.length) {
        const cur = queue.shift();
        for (const d of dirs) {
          const nx = cur.dx + d.dx;
          const ny = cur.dy + d.dy;
          const key = nx + ',' + ny;
          if (Math.abs(nx) > 2 || Math.abs(ny) > 2) continue;
          if (seen[key]) continue;
          seen[key] = true;
          const ax = pos.x + nx;
          const ay = pos.y + ny;
          if (ax < 0 || ay < 0) continue;
          if (blocked[ax + ',' + ay]) continue;
          if (cells[key] === 'pit') continue;
          const first = cur.first || d.n;
          if (cells[key] === kind) return { dir: first, dist: cur.dist + 1 };
          queue.push({ dx: nx, dy: ny, first: first, dist: cur.dist + 1 });
        }
      }
      return null;
    },
    needs(obs) {
      const inv = obs.inventory || {};
      const wood = inv.wood || 0;
      const stone = inv.stone || 0;
      const hasTable = (inv.table || 0) > 0;
      return {
        stone: stone < 1,
        wood: hasTable ? wood < 1 : wood < 3,
        hasTable: hasTable,
        woodCount: wood,
        stoneCount: stone,
      };
    },
    options(observation, primitives) {
      const names = (primitives || []).map((p) => p.name);
      if (names.includes('craft_pick')) return [];
      const need = skills.get.needs(observation);
      if (need.stone && skills.get.plan(observation, 'stone')) {
        return [{ arg: 'stone', about: 'go to the nearest stone and gather it (need 1 stone)' }];
      }
      if (need.wood && skills.get.plan(observation, 'tree')) {
        return [{ arg: 'wood', about: 'go to the nearest tree and gather it (have ' + need.woodCount + ' wood)' }];
      }
      return [];
    },
    async run(api, arg) {
      const kind = arg === 'stone' ? 'stone' : 'tree';
      const blocked = {};
      for (let i = 0; i < 20; i++) {
        const obs = await api.observe();
        if (obs.here === kind) {
          const r = await api.act('gather');
          if (r && r.ok) return 'gathered ' + arg;
          return { ok: false, note: 'could not gather ' + arg };
        }
        const p = skills.get.plan(obs, kind, blocked);
        if (!p) return { ok: false, note: 'no safe path to ' + arg + ' from here' };
        const r = await api.act(p.dir);
        if (!r || !r.ok) {
          const d = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[p.dir];
          blocked[(obs.pos.x + d[0]) + ',' + (obs.pos.y + d[1])] = true;
        }
      }
      return { ok: false, note: 'did not reach ' + arg };
    },
  },
  make: {
    about: 'craft the table or the pick',
    options(observation, primitives) {
      const names = (primitives || []).map((p) => p.name);
      if (names.includes('craft_pick')) {
        return [{ arg: 'pick', about: 'craft the pick now: this finishes the game' }];
      }
      const need = skills.get.needs(observation);
      if (names.includes('craft_table') && !need.hasTable && need.woodCount >= 3) {
        return [{ arg: 'table', about: 'craft the table (uses 2 wood, keeps 1 for the pick)' }];
      }
      return [];
    },
    async run(api, arg) {
      const name = arg === 'pick' ? 'craft_pick' : 'craft_table';
      const prims = await api.primitives();
      if (!prims.some((p) => p.name === name)) {
        return { ok: false, note: 'cannot craft ' + arg + ' right now' };
      }
      const r = await api.act(name);
      if (r && r.ok) return 'crafted ' + arg;
      return { ok: false, note: 'crafting ' + arg + ' failed' };
    },
  },
  explore: {
    about: 'walk a few cells to look for trees or stone, never into a pit',
    options(observation, primitives) {
      const names = (primitives || []).map((p) => p.name);
      if (skills.make.options(observation, primitives).length) return [];
      if (skills.get.options(observation, primitives).length) return [];
      const cells = {};
      for (const c of observation.nearby || []) cells[c.dx + ',' + c.dy] = c.cell;
      const dirs = { north: '0,-1', south: '0,1', east: '1,0', west: '-1,0' };
      const out = [];
      for (const n of Object.keys(dirs)) {
        if (names.includes(n) && cells[dirs[n]] !== 'pit') {
          out.push({ arg: n, about: 'walk up to 3 cells ' + n + ', stopping before any pit' });
        }
      }
      return out;
    },
    async run(api, arg) {
      const dirs = { north: '0,-1', south: '0,1', east: '1,0', west: '-1,0' };
      if (!dirs[arg]) return { ok: false, note: 'unknown direction' };
      let moved = 0;
      for (let i = 0; i < 3; i++) {
        const obs = await api.observe();
        const prims = await api.primitives();
        if (moved > 0 && skills.get.options(obs, prims).length) break;
        const cells = {};
        for (const c of obs.nearby || []) cells[c.dx + ',' + c.dy] = c.cell;
        if (cells[dirs[arg]] === 'pit') break;
        if (!prims.some((p) => p.name === arg)) break;
        const r = await api.act(arg);
        if (!r || !r.ok) break;
        moved++;
      }
      if (moved === 0) return { ok: false, note: 'could not move ' + arg + ', try another direction' };
      return 'walked ' + moved + ' cells ' + arg;
    },
  },
};
