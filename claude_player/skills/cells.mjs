// What is round the player, cell by cell: one small map for each height, north at the top.
// Looks only. For when a walk or a climb fails and the reason is the shape of the place.
//   #  a whole block     .  nothing     ~  water or lava     +  something made     @  the player's feet
// args: { r: 4, down: 2, up: 6 }
const MADE = /^(crafting_table|furnace|chest|barrel|torch|wall_torch|ladder|.*_bed|.*_door|.*_trapdoor|.*_sign|.*_fence|.*_fence_gate|.*_stairs|.*_slab|.*_planks)$/;

export default async function cells({ bot, api }, { r = 4, down = 2, up = 6 } = {}) {
  const feet = bot.entity.position.floored();
  const rows = [];
  for (let y = feet.y + up; y >= feet.y - down; y--) {
    const lines = [];
    for (let z = feet.z - r; z <= feet.z + r; z++) {
      let line = '';
      for (let x = feet.x - r; x <= feet.x + r; x++) {
        const block = bot.blockAt(new api.Vec3(x, y, z));
        const name = block?.name ?? '?';
        line += x === feet.x && z === feet.z && (y === feet.y || y === feet.y + 1) ? '@' : /water|lava/.test(name) ? '~' : MADE.test(name) ? '+' : block?.boundingBox === 'block' ? '#' : '.';
      }
      lines.push(line);
    }
    rows.push(`y${y} ${lines.join('|')}`);
  }
  // The names of what is next to the player, at foot, head and one over: n, s, e, w.
  const beside = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0], ['here', 0, 0]].map(([side, dx, dz]) =>
    `${side} ${[-1, 0, 1, 2].map((dy) => bot.blockAt(new api.Vec3(feet.x + dx, feet.y + dy, feet.z + dz))?.name ?? '?').join('/')}`).join('; ');
  const p = bot.entity.position;
  return { ok: true, note: `exactly ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}, on ground ${bot.entity.onGround}; under/foot/head/over: ${beside}. at ${feet.x} ${feet.y} ${feet.z}, x ${feet.x - r} to ${feet.x + r} left to right, z ${feet.z - r} to ${feet.z + r} between the bars: ${rows.join('  ')}`.slice(0, 1400) };
}
