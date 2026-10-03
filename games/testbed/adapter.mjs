// The testbed: a tiny seeded grid game that exists to exercise the harness. It is not a
// benchmark target. It has the shape a real game has (a world made from a seed, an
// inventory, milestones, a hazard that rolls dice, a death) so that every part of the
// adapter contract is used, and it runs in milliseconds with nothing to install.
//
// The map is rows of characters: '.' grass, 'T' tree, 'S' stone, 'P' pit. North is up
// (y gets smaller), east is right (x gets bigger). options.map and options.start set an
// exact map and start cell for tests; without them the map comes from the seed.

import { prng } from '../../harness/prng.mjs';

const CELL = { '.': 'grass', T: 'tree', S: 'stone', P: 'pit' };
const MOVES = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const GATHERS = { tree: 'wood', stone: 'stone' };

export const defaults = { seed: 'testbed-1', budget: { ticks: 200, calls: 100 } };

export function generate(seed, size) {
  const rng = prng(seed, 'map');
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const r = rng.next();
      row += r < 0.14 ? 'T' : r < 0.24 ? 'S' : r < 0.3 ? 'P' : '.';
    }
    rows.push(row);
  }
  return rows;
}

export function createAdapter() {
  let grid, pos, health, inventory, tick, dice, reached, finished;

  const inside = (x, y) => y >= 0 && y < grid.length && x >= 0 && x < grid[y].length;
  const here = () => CELL[grid[pos.y][pos.x]];
  const have = (item) => inventory[item] ?? 0;

  function give(item, events) {
    inventory[item] = have(item) + 1;
    events.push({ kind: 'item', detail: { item, count: inventory[item] } });
  }

  function milestone(name, events) {
    if (reached.has(name)) return;
    reached.add(name);
    events.push({ kind: 'milestone', detail: { name } });
  }

  function actions() {
    const list = [];
    for (const [name, [dx, dy]] of Object.entries(MOVES)) {
      if (inside(pos.x + dx, pos.y + dy)) list.push({ name, about: `walk one cell ${name}` });
    }
    if (GATHERS[here()]) list.push({ name: 'gather', about: `collect ${GATHERS[here()]} from this cell` });
    if (have('wood') >= 2 && !have('table')) list.push({ name: 'craft_table', about: 'uses 2 wood' });
    if (have('table') && have('wood') >= 1 && have('stone') >= 1 && !have('pick')) {
      list.push({ name: 'craft_pick', about: 'uses 1 wood and 1 stone, needs a table' });
    }
    return list;
  }

  return {
    name: 'testbed',
    version: '1',

    async reset({ seed, options = {} }) {
      const rows = options.map ?? generate(seed, options.size ?? 9);
      for (const row of rows) {
        for (const ch of row) if (!CELL[ch]) throw new Error(`testbed map has an unknown cell '${ch}'`);
      }
      grid = rows.map((row) => [...row]);
      pos = options.start
        ? { x: options.start[0], y: options.start[1] }
        : { x: Math.floor(grid[0].length / 2), y: Math.floor(grid.length / 2) };
      if (!options.map) grid[pos.y][pos.x] = '.';
      health = 3;
      inventory = {};
      tick = 0;
      reached = new Set();
      finished = null;
      dice = prng(seed, 'dice');
    },

    observe() {
      const nearby = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = pos.x + dx;
          const y = pos.y + dy;
          if ((dx || dy) && inside(x, y) && grid[y][x] !== '.') nearby.push({ dx, dy, cell: CELL[grid[y][x]] });
        }
      }
      return { tick, pos: { ...pos }, health, inventory: { ...inventory }, here: here(), nearby };
    },

    actions,

    act(action) {
      const events = [];
      const name = action.name;
      if (!actions().some((a) => a.name === name)) {
        return { result: { ok: false, error: 'not possible now' }, events };
      }
      if (MOVES[name]) {
        const [dx, dy] = MOVES[name];
        pos = { x: pos.x + dx, y: pos.y + dy };
        tick += 1;
        if (here() === 'pit') {
          // The game's own dice. The roll goes in the log with the damage it caused.
          const roll = dice.int(2);
          health -= 1 + roll;
          events.push({ kind: 'damage', detail: { source: 'pit', amount: 1 + roll, roll, health } });
          if (health <= 0) events.push({ kind: 'death', detail: { cause: 'pit' } });
        }
        return { result: { ok: true, pos: { ...pos } }, events };
      }
      if (name === 'gather') {
        const item = GATHERS[here()];
        grid[pos.y][pos.x] = '.';
        tick += 2;
        give(item, events);
        milestone(`first_${item}`, events);
        return { result: { ok: true, item }, events };
      }
      if (name === 'craft_table') {
        inventory.wood -= 2;
        tick += 3;
        give('table', events);
        milestone('table', events);
        return { result: { ok: true, item: 'table' }, events };
      }
      inventory.wood -= 1;
      inventory.stone -= 1;
      tick += 3;
      give('pick', events);
      milestone('pick', events);
      finished = 'complete';
      return { result: { ok: true, item: 'pick' }, events };
    },

    tick: () => tick,

    ended: () => (health <= 0 ? 'death' : finished),

    metrics({ steps, events }) {
      const items = new Set();
      const cells = new Set();
      const firstTicks = {};
      let damage = 0;
      let milestones = 0;
      for (const e of events) {
        if (e.kind === 'item') items.add(e.detail.item);
        if (e.kind === 'damage') damage += e.detail.amount;
        if (e.kind === 'milestone') {
          milestones += 1;
          firstTicks[`tick_of_${e.detail.name}`] = e.tick;
        }
      }
      for (const s of steps) {
        cells.add(`${s.observation.pos.x},${s.observation.pos.y}`);
        if (s.result.pos) cells.add(`${s.result.pos.x},${s.result.pos.y}`);
      }
      return { unique_items: items.size, milestones, cells_visited: cells.size, damage_taken: damage, ...firstTicks };
    },

    describe() {
      return [
        'You are on a small grid. North is up, east is right.',
        'Trees give wood and stones give stone when you gather on their cell.',
        'A table costs 2 wood. A pick costs 1 wood and 1 stone and needs a table.',
        'Crafting the pick finishes the game. Pits hurt; at 0 health you die.',
        'You see only cells within 2 steps: "nearby" lists each as dx, dy from you',
        '(dx above 0 is east, dy above 0 is south). "here" is the cell you stand on.',
      ].join(' ');
    },

    // Every action this game has, whatever the state. The coach reads this to write skills.
    vocabulary() {
      return [
        ...Object.keys(MOVES).map((name) => ({ name, about: `walk one cell ${name}; costs 1 tick; not possible at the edge of the map` })),
        { name: 'gather', about: 'collect wood from the tree, or stone from the stone, on the cell you stand on; costs 2 ticks; the cell turns to grass' },
        { name: 'craft_table', about: 'uses 2 wood; costs 3 ticks; one table is enough' },
        { name: 'craft_pick', about: 'uses 1 wood and 1 stone, needs a table; costs 3 ticks; finishes the game' },
      ];
    },

    close() {},
  };
}
