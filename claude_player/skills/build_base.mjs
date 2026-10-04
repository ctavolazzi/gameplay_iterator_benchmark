// The base: a room three by three and two high, seven blocks under the home site, closed
// all round, with the crafting table, the furnace, a torch and the bed in it. Deep enough
// that what walks the surface at night is too far off to stop anyone sleeping.
// No args. Run again, it digs nothing twice and puts down whatever furniture is carried.
export default async function buildBase({ bot, api, memory, note }) {
  const home = memory.home;
  if (!home) return { ok: false, note: 'no home site remembered' };
  const at = memory.base ?? { x: home.x, y: home.y - 7, z: home.z };
  const c = new api.Vec3(at.x, at.y, at.z);
  // In by the doorway in the east wall when the room exists; straight down when it is still to be dug.
  if (memory.base && bot.entity.position.distanceTo(c) > 2.5) {
    await api.walk(new api.goals.GoalBlock(c.x + 2, c.y, c.z), 150000, 'going down to the doorway').catch((error) => { api.check(); note(error.message); });
  }
  await api.walk(new api.goals.GoalBlock(c.x, c.y, c.z), 150000, 'going down to the base');

  const room = [];
  for (const dy of [1, 0]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) room.push(c.offset(dx, dy, dz));
  const dug = await api.digOut(room);
  if (!dug.ok) return { ok: false, note: `${dug.error} after ${dug.dug} blocks` };
  memory.base = api.round(c);
  await api.walk(new api.goals.GoalBlock(c.x, c.y, c.z), 8000, 'back to the middle').catch(() => {});

  // Close every gap in the floor, the walls and the ceiling: the way in is one of them.
  const shell = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 2; dy++) {
    const inside = Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && dy >= 0 && dy <= 1;
    const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
    const edge = (Math.abs(dx) === 2 || Math.abs(dz) === 2) && (dy === -1 || dy === 2);
    if (!inside && !corner && !edge) shell.push(c.offset(dx, dy, dz));
  }
  let filled = 0;
  let open = 0;
  for (const cell of shell) {
    if (api.solid(cell)) continue;
    if (filled < 16 && await api.fill(cell)) filled += 1; else open += 1;
  }

  const put = [];
  // Everything stands along the north wall. The middle row and the corner at the foot of the
  // bed are the way from the bed to the doorway and are kept clear: a chest put in the middle
  // of the west wall shut the player in that corner for 28 minutes (turn 13).
  const spots = { crafting_table: c.offset(-1, 0, -1), furnace: c.offset(0, 0, -1), chest: c.offset(1, 0, -1) };
  for (const [item, cell] of Object.entries(spots)) {
    if (!api.carried()[item]) continue;
    const placed = await api.placeAt(item, cell);
    // What stands in the base is remembered apart from what was last put down anywhere: a table
    // set down in a mine 36 blocks below once made the brain think the base had lost its own.
    if (placed.ok) { put.push(item); (memory.baseHas ??= {})[item] = placed.at; } else note(`${item}: ${placed.error}`);
  }
  // The bed lies along the far wall. It is placed from the cell at its foot, facing along the wall.
  const bed = Object.keys(api.carried()).find((name) => name.endsWith('_bed'));
  if (bed) {
    const stand = c.offset(-1, 0, 1);
    await api.walk(new api.goals.GoalBlock(stand.x, stand.y, stand.z), 8000, 'standing at the foot of the bed').catch(() => {});
    const placed = await api.placeAt(bed, c.offset(0, 0, 1));
    if (placed.ok) { put.push(bed); (memory.places ??= {}).bed = placed.at; } else note(`bed: ${placed.error}`);
  }
  return { ok: open === 0, note: `room at ${c.x} ${c.y} ${c.z}: dug ${dug.dug}, closed ${filled} gaps, ${open} still open, put down ${put.join(', ') || 'nothing'}` };
}
