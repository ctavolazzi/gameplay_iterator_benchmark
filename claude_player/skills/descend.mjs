// Dig down to a height, to get among what is found deeper. args: { toY: 16 }
// The pathfinder picks the way and will not dig into water or lava.
export default async function descend({ bot, api }, { toY }) {
  if (typeof toY !== 'number') return { ok: false, note: 'say how deep: toY' };
  const from = Math.floor(bot.entity.position.y);
  if (from <= toY) return { ok: true, note: `already at ${from}` };
  let why = '';
  await api.walk(new api.goals.GoalY(toY), 240000, `digging down to ${toY}`, true).catch((error) => {
    if (/reflex|asked|died|out of time/.test(error.message)) throw error;
    why = `: ${error.message}`;
  });
  const now = Math.floor(bot.entity.position.y);
  const ok = now <= from - 3;
  return { ok, note: `went from ${from} to ${now}, wanted ${toY}${ok ? '' : why}` };
}
