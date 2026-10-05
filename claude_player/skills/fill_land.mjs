// Fill every dip and hole in a rectangle up to a level, so the ground is whole at that
// height: the other half of flatten.mjs, for the field a farm stands on. The top block is
// earth (crops need it); under it goes whatever stone is carried. Looks at the world after
// each block, not at the reply. args: { x1, z1, x2, z2, level: 65, seconds: 300, depth: 8 }
const UNDER = /^(cobblestone|cobbled_deepslate|diorite|andesite|granite|tuff|stone|dirt)$/;

export default async function fillLand({ bot, api }, { x1, z1, x2, z2, level = 65, seconds = 300, depth = 8, anyTop = false }) {
  if (![x1, z1, x2, z2, level].every(Number.isInteger)) return { ok: false, note: 'say the corners and the level: x1, z1, x2, z2, level' };
  const [xa, xb, za, zb] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(z1, z2), Math.max(z1, z2)];
  const until = Date.now() + Math.max(10, Math.min(880, Number(seconds) || 300)) * 1000;
  const { Vec3, goals } = api;
  const solid = (at) => bot.blockAt(at)?.boundingBox === 'block';
  const wet = (at) => /water|lava/.test(bot.blockAt(at)?.name ?? '');

  // The empty cells, lowest first in each column. A column with water or lava in it is left.
  function gaps() {
    const cells = [];
    let wetColumns = 0;
    for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
      if (solid(new Vec3(x, level, z))) continue;
      let floor = level - 1;
      while (floor > level - depth && !solid(new Vec3(x, floor, z))) floor -= 1;
      const column = [];
      for (let y = floor + 1; y <= level; y++) column.push(new Vec3(x, y, z));
      if (column.some(wet) || !solid(new Vec3(x, floor, z))) { wetColumns += 1; continue; }
      cells.push(...column);
    }
    return { cells, wetColumns };
  }

  let placed = 0, error = null;
  const later = new Map();
  const key = (at) => `${at.x},${at.y},${at.z}`;
  try {
    while (Date.now() < until) {
      api.check();
      const feet = bot.entity.position.floored();
      const todo = gaps().cells.filter((c) => !(later.get(key(c)) > Date.now()))
        // Lowest first, then nearest: a column is built from its floor up.
        .sort((a, b) => (a.distanceTo(feet) + (a.y - level) * 0.1) - (b.distanceTo(feet) + (b.y - level) * 0.1));
      if (!todo.length) break;
      // The lowest empty cell of the nearest column.
      const first = todo[0];
      const cell = todo.filter((c) => c.x === first.x && c.z === first.z).sort((a, b) => a.y - b.y)[0];
      // The top block is earth for a field. Under a building any stone will do (anyTop).
      const item = api.find(cell.y === level && !anyTop ? /^dirt$/ : UNDER) ?? api.find(/^dirt$/);
      if (!item) { error = `nothing carried to fill with (${todo.length} cells left)`; break; }
      try {
        // Stand beside the column, never in it.
        if (feet.x === cell.x && feet.z === cell.z || cell.offset(0.5, 0.5, 0.5).distanceTo(bot.entity.position.offset(0, 1.62, 0)) > 4) {
          await api.walk(new goals.GoalNear(cell.x, level + 1, cell.z, 2), 20000, 'walking to the hole');
          const here = bot.entity.position.floored();
          if (here.x === cell.x && here.z === cell.z) {
            const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => new Vec3(cell.x + dx, level, cell.z + dz)).find(solid);
            if (side) await api.walk(new goals.GoalBlock(side.x, level + 1, side.z), 8000, 'stepping out of the hole');
          }
        }
        await api.settle();
        const now = bot.entity.position.floored();
        if (now.x === cell.x && now.z === cell.z && now.y <= cell.y + 1) throw new Error('standing in the hole');
        await bot.equip(item, 'hand');
        let done = false;
        for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
          const against = bot.blockAt(cell.offset(dx, dy, dz));
          if (against?.boundingBox !== 'block') continue;
          await api.within(bot.placeBlock(against, new Vec3(-dx, -dy, -dz)), 4000, 'filling').catch(() => {});
          await api.sleep(150);
          if (solid(cell)) { done = true; break; }
        }
        if (!done) throw new Error('the block did not appear');
        placed += 1;
      } catch (failure) {
        api.check();
        later.set(key(cell), Date.now() + 20000);
        error = failure.message;
      }
    }
  } catch (failure) {
    error = failure.message;
  } finally {
    bot.pathfinder.setGoal(null);
  }
  const after = gaps();
  return { ok: placed > 0 || after.cells.length === 0,
    note: `filled ${placed}; ${after.cells.length} cells still empty at or under ${level}, ${after.wetColumns} columns left for water or no floor${error ? `; last trouble: ${error}` : ''}`, left: after.cells.length };
}
