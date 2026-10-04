// Walk to a player. args: { player: 'fogsift' }
export default async function come({ bot, api }, { player }) {
  const target = bot.players[player]?.entity;
  if (!target) return { ok: false, note: `${player} is out of sight` };
  await api.walk(new api.goals.GoalFollow(target, 2), 50000, `walking to ${player}`);
  return { ok: true, note: `with ${player}` };
}
