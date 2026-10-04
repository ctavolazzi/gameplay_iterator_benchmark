// Walk some way in one direction. args: { direction: 'north' | 'south' | 'east' | 'west', blocks: 24 }
const DIRECTIONS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

export default async function explore({ bot, api }, { direction = 'north', blocks = 24 }) {
  const step = DIRECTIONS[direction];
  if (!step) return { ok: false, note: `no direction called ${direction}` };
  const from = bot.entity.position.clone();
  await api.walk(new api.goals.GoalNearXZ(from.x + step[0] * blocks, from.z + step[1] * blocks, 3), 20000 + blocks * 1000, `walking ${direction}`)
    .catch((error) => { if (/reflex|asked to stop|died/.test(error.message)) throw error; });
  const moved = Math.round(bot.entity.position.distanceTo(from));
  return { ok: moved >= Math.min(3, blocks), note: `moved ${moved} blocks ${direction}` };
}
