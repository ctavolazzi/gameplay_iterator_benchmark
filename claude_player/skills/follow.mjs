// Stay with a player: walk after them wherever they go, until the time is up, they have been
// out of sight for half a minute, or the step is stopped. Nothing is dug or built on the way:
// the way to a person may run through what that person has built.
// args: { player: 'fogsift', seconds: 600, range: 3 }
export default async function follow({ bot, api }, { player, seconds = 600, range = 3 }) {
  if (typeof player !== 'string' || !player) return { ok: false, note: 'say who: player' };
  const started = Date.now();
  const until = started + Math.max(5, Math.min(880, Number(seconds) || 600)) * 1000;
  const moves = bot.pathfinder.movements;
  const was = { canDig: moves.canDig, towers: moves.allow1by1towers, scaffold: moves.scafoldingBlocks };
  moves.canDig = false;
  moves.allow1by1towers = false;
  moves.scafoldingBlocks = [];
  let following = null, unseen = 0, walked = 0;
  let last = bot.entity.position.clone();
  try {
    while (Date.now() < until && unseen <= 60) {
      api.check();
      const target = bot.players[player]?.entity ?? null;
      if (!target) unseen += 1;
      else {
        unseen = 0;
        // The pathfinder keeps after a moving goal by itself. It is given again when the player
        // comes back into sight as a new entity, or a reflex has cleared it after a fight.
        if (target !== following || !bot.pathfinder.goal) {
          following = target;
          bot.pathfinder.setGoal(new api.goals.GoalFollow(target, range), true);
        }
      }
      walked += bot.entity.position.distanceTo(last);
      last = bot.entity.position.clone();
      await api.sleep(500);
    }
  } finally {
    bot.pathfinder.setGoal(null);
    moves.canDig = was.canDig;
    moves.allow1by1towers = was.towers;
    moves.scafoldingBlocks = was.scaffold;
  }
  const them = bot.players[player]?.entity;
  const time = Math.round((Date.now() - started) / 1000);
  if (unseen > 60) return { ok: false, note: `lost sight of ${player} after ${time} s and ${Math.round(walked)} blocks` };
  const far = them ? `${Math.round(them.position.distanceTo(bot.entity.position))} blocks from them` : 'they are out of sight';
  return { ok: true, note: `followed ${player} for ${time} s over ${Math.round(walked)} blocks; ${far} at the end` };
}
