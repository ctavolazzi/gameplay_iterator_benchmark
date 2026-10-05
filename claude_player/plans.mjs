// Plans of things to build, with no game connection: which block goes in which cell, in what
// order, from where the player stands to place it, and what it all takes. skills/build.mjs
// builds from a plan and reads the world back against it. A plan can be walked by a test
// before a block is placed (tests/claude_plans.test.mjs), which is how the room with no way
// out and the fence with the player inside it should have been caught.
//
// A plan: { name, origin, size: { w, h, d }, stages: [{ name, from, cells }], door, spots, bill }
//   cell    { x, y, z, role }: role is 'planks', 'log', 'chest', 'torch' or 'door'
//   from    'outside': each cell is placed from the ground just outside the footprint
//           'inside': from the middle of the floor      'door': from the cell outside the door
//   bill    how many of each role the whole plan takes
// origin is the north-west corner of the footprint, at the height a player stands (the floor
// is the ground under it). Every plan here has its door in the middle of its south side.

const key = ({ x, y, z }) => `${x},${y},${z}`;

function bill(stages) {
  const out = {};
  for (const stage of stages) for (const cell of stage.cells) out[cell.role] = (out[cell.role] ?? 0) + 1;
  return out;
}

// A storehouse, 5 by 5 and 3 high inside its roof: posts of log at the corners, walls and a
// flat roof of planks, a door, three chests along the back wall (two of them join into one
// large chest) and a torch. CT, 2026-10-04: "collecting resources ... building structures".
// The pack was full all that day and the base's one chest too; what was gathered was thrown away.
export function storehouse(origin) {
  const { x, y, z } = origin;
  const at = (dx, dy, dz, role) => ({ x: x + dx, y: y + dy, z: z + dz, role });
  const doorway = [at(2, 0, 4, 'door'), at(2, 1, 4, 'door')];
  const walls = [];
  // Column by column, bottom up, so that each column is finished from one place to stand.
  for (let dx = 0; dx <= 4; dx++) for (let dz = 0; dz <= 4; dz++) {
    if (dx !== 0 && dx !== 4 && dz !== 0 && dz !== 4) continue;
    const corner = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
    for (let dy = 0; dy <= 2; dy++) {
      if (dx === 2 && dz === 4 && dy <= 1) continue;
      walls.push(at(dx, dy, dz, corner ? 'log' : 'planks'));
    }
  }
  // The roof: over the walls first, then inward, so that every block has one beside or under it.
  const roof = [];
  for (const ring of [true, false]) for (let dx = 0; dx <= 4; dx++) for (let dz = 0; dz <= 4; dz++) {
    const edge = dx === 0 || dx === 4 || dz === 0 || dz === 4;
    if (edge === ring) roof.push(at(dx, 3, dz, 'planks'));
  }
  roof.sort((a, b) => (Math.abs(a.x - x - 2) + Math.abs(a.z - z - 2) === 0) - (Math.abs(b.x - x - 2) + Math.abs(b.z - z - 2) === 0));
  const inside = [at(1, 0, 3, 'torch'), at(1, 0, 1, 'chest'), at(2, 0, 1, 'chest'), at(3, 0, 1, 'chest')];
  const stages = [
    { name: 'walls', from: 'outside', cells: walls },
    { name: 'inside', from: 'inside', cells: inside },
    { name: 'roof', from: 'inside', cells: roof },
    { name: 'door', from: 'door', cells: [doorway[0]] },
  ];
  return { name: 'storehouse', origin: { x, y, z }, size: { w: 5, h: 4, d: 5 }, stages, bill: bill(stages),
    door: { cell: { x: x + 2, y, z: z + 4 }, outside: { x: x + 2, y, z: z + 5 }, inside: { x: x + 2, y, z: z + 3 } },
    spots: { middle: { x: x + 2, y, z: z + 2 } },
    chests: inside.filter((cell) => cell.role === 'chest').map(({ role, ...cell }) => cell) };
}

export const PLANS = { storehouse };

// Where the player stands to place a cell of a stage. For 'outside' it is the ground one step
// out from the wall the cell is in (a corner is placed from its west or east side).
export function standFor(plan, stage, cell) {
  if (stage.from === 'inside') return plan.spots.middle;
  if (stage.from === 'door') return plan.door.outside;
  const { x, y, z } = plan.origin;
  const { w, d } = plan.size;
  if (cell.x === x) return { x: x - 1, y, z: cell.z };
  if (cell.x === x + w - 1) return { x: x + w, y, z: cell.z };
  if (cell.z === z) return { x: cell.x, y, z: z - 1 };
  return { x: cell.x, y, z: z + d };
}

// The faults of a plan that can be seen without building it. A plan with none is safe to build:
//   every cell has, at the time it is placed, a block under it or beside it to place it against
//   nothing is placed where the player stands to place it, and it is within reach from there
//   from the cell inside the door the middle of the floor can be walked to, and so can a cell
//   next to every chest (what is put down inside must not shut the room off)
//   no cell is used twice
export function planFaults(plan, { reach = 4.5 } = {}) {
  const faults = [];
  const { x, y, z } = plan.origin;
  const placed = new Set();
  const ground = (cell) => cell.y === y - 1;   // the ground under the footprint and round it is whole
  const solid = (cell) => ground(cell) || placed.has(key(cell));
  const seen = new Set();
  for (const stage of plan.stages) for (const cell of stage.cells) {
    if (seen.has(key(cell))) faults.push({ what: 'a cell is used twice', cell });
    seen.add(key(cell));
    const stand = standFor(plan, stage, cell);
    if (stand.x === cell.x && stand.z === cell.z && (cell.y === stand.y || cell.y === stand.y + 1)) faults.push({ what: 'placed where the player stands', cell });
    const far = Math.hypot(cell.x + 0.5 - (stand.x + 0.5), cell.y + 0.5 - (stand.y + 1.62), cell.z + 0.5 - (stand.z + 0.5));
    if (far > reach) faults.push({ what: `out of reach from where it is placed (${far.toFixed(1)})`, cell });
    const against = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => solid({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }));
    if (!against) faults.push({ what: 'nothing to place it against when its turn comes', cell });
    // A torch and a door do not hold anything up, and a door takes two cells.
    if (cell.role !== 'torch' && cell.role !== 'door') placed.add(key(cell));
  }
  // Walking, when it is all built: a cell can be stood in when it and the one over it are free.
  const blocked = new Set();
  for (const stage of plan.stages) for (const cell of stage.cells) if (cell.role !== 'torch' && cell.role !== 'door') blocked.add(key(cell));
  const free = (cx, cz) => !blocked.has(key({ x: cx, y, z: cz })) && !blocked.has(key({ x: cx, y: y + 1, z: cz }))
    && cx > x && cx < x + plan.size.w - 1 && cz > z && cz < z + plan.size.d - 1;
  const reached = new Set();
  const queue = [plan.door.inside];
  if (free(plan.door.inside.x, plan.door.inside.z)) reached.add(`${plan.door.inside.x},${plan.door.inside.z}`);
  else faults.push({ what: 'the cell inside the door is not free', cell: plan.door.inside });
  while (queue.length) {
    const at = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: at.x + dx, z: at.z + dz };
      if (reached.has(`${next.x},${next.z}`) || !free(next.x, next.z)) continue;
      reached.add(`${next.x},${next.z}`);
      queue.push(next);
    }
  }
  if (!reached.has(`${plan.spots.middle.x},${plan.spots.middle.z}`)) faults.push({ what: 'the middle of the floor cannot be walked to from the door', cell: plan.spots.middle });
  for (const chest of plan.chests ?? []) {
    const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => reached.has(`${chest.x + dx},${chest.z + dz}`));
    if (!beside) faults.push({ what: 'a chest that cannot be stood beside', cell: chest });
    if (blocked.has(key({ x: chest.x, y: chest.y + 1, z: chest.z }))) faults.push({ what: 'a chest with a block over it will not open', cell: chest });
  }
  return faults;
}

// What a role is in the world: the name of any block that will do for it.
export const ROLE = {
  planks: /_planks$/, log: /_log$/, chest: /^chest$/, torch: /^(torch|wall_torch)$/, door: /_door$/,
};

// The plan against the world: name(cell) says what block is there. Gives the cells still
// wrong, in the order the plan places them.
export function planMissing(plan, name) {
  const out = [];
  for (const stage of plan.stages) for (const cell of stage.cells) {
    if (!ROLE[cell.role].test(name(cell) ?? '')) out.push({ stage: stage.name, ...cell });
  }
  return out;
}
