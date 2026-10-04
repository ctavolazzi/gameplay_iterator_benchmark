// Ask the pathfinder for a path without walking it, and say what it found.
// args: { dx: 0, dz: -8 } (a place relative to the player) and optional ms to think.
export default async function pathCheck({ bot, api }, { dx = 0, dz = -8, ms = 8000 }) {
  const from = bot.entity.position;
  const goal = new api.goals.GoalNearXZ(from.x + dx, from.z + dz, 1);
  const started = Date.now();
  const found = bot.pathfinder.getPathTo(bot.pathfinder.movements, goal, ms);
  const m = bot.pathfinder.movements;
  return { ok: found.status === 'success', note: `status ${found.status}, ${found.path.length} moves, cost ${Math.round(found.cost)}, ${found.visitedNodes} places looked at in ${Date.now() - started} ms; ` +
    `first moves ${found.path.slice(0, 4).map((p) => `${p.x} ${p.y} ${p.z}${p.toBreak?.length ? ` break ${p.toBreak.length}` : ''}${p.toPlace?.length ? ` place ${p.toPlace.length}` : ''}`).join(' > ')}; ` +
    `canDig ${m.canDig}, maxDropDown ${m.maxDropDown}, liquidCost ${m.liquidCost}, digCost ${m.digCost}, cannot break ${m.blocksCantBreak.size} kinds, step rules ${m.exclusionAreasStep.length}, break rules ${m.exclusionAreasBreak.length}; on ground ${bot.entity.onGround}, controls ${JSON.stringify(bot.controlState)}` };
}
