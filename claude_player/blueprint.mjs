// The plan of the bigger base. fogsift, in the game at 06:17 on 2026-10-04: "Claude can you
// build a bigger base?"; CT, the same day, to the plan put to him (a plain room beside the
// one it has, stairs up, stairs down to the mine): "begin".
//
// This file is the plan only: which cells are dug out, which must be solid, and where the
// ways in are. It has no game connection, so tests can walk the plan before a block is dug.
// skills/build_hall.mjs builds from it and checks the world against it afterwards.
//
// c is the middle of the bedroom's floor (memory.base). The bedroom is 3 by 3 and 2 high, with
// its doorway in the middle of its east wall. Everything here is east of that wall.
//
//        north (z smaller)
//   bedroom | hall, 7 by 7, 3 high
//    . . .  # . . . . . . . #
//    . c .  D . . . . . . . #      D  the bedroom's doorway (there already)
//    . . .  # . . . . . . . #      E  the hall's entrance, in the middle of its south wall
//           # # # # E # # # #
//                   s             s  stairs: one cell on the level, then up one for each one south
//                   s

const key = ([x, y, z]) => `${x},${y},${z}`;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// steps: how many stairs it takes to come out on the ground (found by the builder: it differs
// with the lie of the land).
export function hallPlan(c, steps = 8) {
  const interior = [];
  for (let x = c.x + 3; x <= c.x + 9; x++) for (let z = c.z - 3; z <= c.z + 3; z++) for (let y = c.y + 2; y >= c.y; y--) interior.push([x, y, z]);
  const bedroomDoor = [[c.x + 2, c.y, c.z], [c.x + 2, c.y + 1, c.z]];
  const entrance = [[c.x + 6, c.y, c.z + 4], [c.x + 6, c.y + 1, c.z + 4]];
  const stairs = [];
  for (let j = 0; j <= steps; j++) {
    const z = c.z + 5 + j, stand = c.y + Math.max(0, j);
    stairs.push({ floor: [c.x + 6, stand - 1, z], clear: [[c.x + 6, stand + 2, z], [c.x + 6, stand + 1, z], [c.x + 6, stand, z]] });
  }
  // The shell: every cell that touches the inside and is neither inside nor a way in.
  const inside = new Set(interior.map(key));
  const open = new Set([...bedroomDoor, ...entrance].map(key));
  const shell = [];
  for (let x = c.x + 2; x <= c.x + 10; x++) for (let z = c.z - 4; z <= c.z + 4; z++) for (let y = c.y - 1; y <= c.y + 3; y++) {
    const cell = [x, y, z];
    if (inside.has(key(cell)) || open.has(key(cell))) continue;
    if (SIDES.some(([dx, dy, dz]) => inside.has(key([x + dx, y + dy, z + dz])))) shell.push(cell);
  }
  // Light: a dark room under ground fills with monsters. Three torches on the hall's floor
  // leave no part of it dark, and one on every fourth stair.
  const torches = [[c.x + 4, c.y, c.z - 2], [c.x + 8, c.y, c.z - 2], [c.x + 4, c.y, c.z + 2], [c.x + 8, c.y, c.z + 2],
    ...stairs.filter((_, j) => j % 4 === 2).map((s) => s.clear[2])];
  // Chests stand along the north wall, two pairs with a gap between them, clear of the doorway's row.
  const chests = [[c.x + 4, c.y, c.z - 3], [c.x + 5, c.y, c.z - 3], [c.x + 7, c.y, c.z - 3], [c.x + 8, c.y, c.z - 3]];
  return { c: { x: c.x, y: c.y, z: c.z }, steps, interior, shell, bedroomDoor, entrance, stairs, torches, chests };
}

// Whether a cell is part of what the pathfinder must never dig: the hall's shell and the
// blocks the stairs stand on. The two ways in are not. (The bedroom's own shell is lib.mjs's.)
export function keptWhole(plan, at) {
  const { c } = plan;
  if (at.x === c.x + 6 && at.z === c.z + 4 && (at.y === c.y || at.y === c.y + 1)) return false;
  if (at.x === c.x + 2 && at.z === c.z && (at.y === c.y || at.y === c.y + 1)) return false;
  const inBox = at.x >= c.x + 2 && at.x <= c.x + 10 && at.z >= c.z - 4 && at.z <= c.z + 4 && at.y >= c.y - 1 && at.y <= c.y + 3;
  if (inBox) return true;
  const j = at.z - (c.z + 5);
  return at.x === c.x + 6 && j >= 0 && j <= plan.steps && at.y === c.y + j - 1;
}

// The built thing looked at against the plan. open(cell) says a player can be in the cell;
// solid(cell) says it is a whole block. Gives every fault: a cell of the inside that is
// blocked, a gap in the shell, a stair that cannot be stood on, and any part of the hall's
// floor that cannot be walked to from the bedroom's doorway (pure.mjs reaches()).
export function checkHall(plan, { open, solid, furniture = () => false }) {
  const faults = [];
  for (const cell of plan.interior) if (!open(cell) && !furniture(cell)) faults.push({ what: 'the inside is blocked', cell });
  for (const cell of plan.shell) if (!solid(cell)) faults.push({ what: 'a gap in the shell', cell });
  for (const cell of plan.entrance) if (!open(cell)) faults.push({ what: 'the entrance is blocked', cell });
  plan.stairs.forEach((stair, j) => {
    if (!solid(stair.floor)) faults.push({ what: `stair ${j} has nothing to stand on`, cell: stair.floor });
    for (const cell of stair.clear) if (!open(cell)) faults.push({ what: `stair ${j} is blocked`, cell });
  });
  // Walking: from the cell inside the bedroom's doorway, over the hall's floor, out by the
  // entrance and up every stair.
  const { c } = plan;
  const standable = (x, y, z) => open([x, y, z]) && open([x, y + 1, z]) && !furniture([x, y, z]);
  const seen = new Set();
  const queue = [[c.x + 3, c.y, c.z]];
  if (standable(...queue[0])) seen.add(key(queue[0]));
  while (queue.length) {
    const [x, y, z] = queue.shift();
    if (!seen.has(key([x, y, z]))) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
      const next = [x + dx, y + dy, z + dz];
      if (seen.has(key(next)) || !standable(...next) || !(solid([next[0], next[1] - 1, next[2]]) || furniture([next[0], next[1] - 1, next[2]]))) continue;
      if (dy === 1 && !open([x, y + 2, z])) continue;          // no room to jump up
      seen.add(key(next));
      queue.push(next);
    }
  }
  const floor = plan.interior.filter(([, y]) => y === c.y).filter((cell) => !furniture(cell));
  for (const cell of floor) if (!seen.has(key(cell))) faults.push({ what: 'cannot be walked to from the bedroom', cell });
  const top = plan.stairs[plan.stairs.length - 1].clear[2];
  if (!seen.has(key(top))) faults.push({ what: 'the top of the stairs cannot be walked to from the bedroom', cell: top });
  return faults;
}
