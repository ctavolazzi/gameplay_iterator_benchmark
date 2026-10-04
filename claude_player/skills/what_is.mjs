// The block at each of some places: its name, whether the game's data calls it solid, and
// the shape the player's body collides with (which is a separate table, and can disagree).
// args: { at: [[x, y, z], ...] }, or no args for the cells around where the player stands.
export default async function whatIs({ bot, api }, { at }) {
  const feet = bot.entity.position.floored();
  const places = at ?? [[0, 0, 0], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]
    .map(([dx, dy, dz]) => [feet.x + dx, feet.y + dy, feet.z + dz]);
  return { ok: true, note: places.map(([x, y, z]) => {
    const block = bot.blockAt(new api.Vec3(x, y, z));
    return `${x} ${y} ${z}: ${block?.name ?? 'unknown'} (${block?.boundingBox ?? '?'}, shape ${JSON.stringify(block?.shapes ?? null)})`;
  }).join('; ') };
}
