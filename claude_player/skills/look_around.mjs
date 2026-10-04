// The blocks right around the player, layer by layer, as a small map. args: { r: 3 }
export default async function lookAround({ bot }, { r = 3 }) {
  const c = bot.entity.position.floored();
  const short = (name) => (name === 'air' ? '.' : name.endsWith('_bed') ? 'B' : name === 'crafting_table' ? 'T' : name === 'furnace' ? 'F' : /torch/.test(name) ? 'i' : /water/.test(name) ? '~' : /lava/.test(name) ? '!' : /dirt|grass/.test(name) ? 'd' : /stone|andesite|diorite|granite/.test(name) ? '#' : name[0]);
  const layers = [];
  for (let dy = 2; dy >= -1; dy--) {
    const rows = [];
    for (let dz = -r; dz <= r; dz++) {
      let row = '';
      for (let dx = -r; dx <= r; dx++) row += dx === 0 && dz === 0 && (dy === 0 || dy === 1) ? '@' : short(bot.blockAt(c.offset(dx, dy, dz))?.name ?? '?');
      rows.push(row);
    }
    layers.push(`y${c.y + dy}: ${rows.join('/')}`);
  }
  return { ok: true, note: `at ${c.x} ${c.y} ${c.z} (x to the right, z down) ${layers.join(' | ')}` };
}
