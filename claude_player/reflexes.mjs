// What the player does without being asked. tick() runs twice a second, whether or not a
// skill is running. state persists between ticks; state.holdUntil keeps the next queued
// skill from starting. Version 1: hit back, back away from creepers and when badly hurt,
// eat when hungry and idle. Each first sighting of a hostile is journalled as an encounter.

export async function tick({ bot, api, state, busy, event, interrupt }) {
  const now = Date.now();
  const me = bot.entity.position;
  const foe = api.nearestHostile(10);
  const distance = foe ? foe.position.distanceTo(me) : Infinity;

  if (foe) {
    state.seen ??= {};
    if (!state.seen[foe.id]) {
      state.seen[foe.id] = now;
      event('encounter', { foe: foe.name, distance: +distance.toFixed(1), health: bot.health, busy, isDay: bot.time?.isDay ?? null });
    }
  }

  // Back away: from a creeper that is close, or from anything when badly hurt.
  const mustFlee = foe && ((foe.name === 'creeper' && distance < 5) || (bot.health <= 8 && distance < 8));
  if (mustFlee) {
    if (busy) interrupt(`backing away from a ${foe.name}`);
    if (!state.fleeing) event('flee', { foe: foe.name, distance: +distance.toFixed(1), health: bot.health });
    state.fleeing = now + 4000;
    state.holdUntil = now + 5000;
  }
  if (state.fleeing && now < state.fleeing) {
    if (foe) bot.pathfinder.setGoal(new api.goals.GoalInvert(new api.goals.GoalFollow(foe, 14)), true);
    return;
  }
  if (state.fleeing) {
    state.fleeing = 0;
    if (!busy) bot.pathfinder.setGoal(null);
  }

  // Hit back whatever is in reach, with the best weapon when nothing else is using the hand.
  if (foe && distance < 3.5 && foe.name !== 'creeper' && now - (state.lastHit ?? 0) > 650) {
    if (!busy) {
      const weapon = api.find(/_sword$/) ?? api.find(/_axe$/);
      if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand');
    }
    await bot.lookAt(foe.position.offset(0, foe.height * 0.6, 0), true);
    bot.attack(foe);
    state.lastHit = now;
    return;
  }

  // Eat when hungry and nothing else is going on; when starving, stop the skill for it.
  if (bot.food <= 6 && busy && now - (state.lastEat ?? 0) > 5000) interrupt('starving');
  if (bot.food <= 14 && !busy && now - (state.lastEat ?? 0) > 5000) {
    state.lastEat = now;
    state.holdUntil = now + 3000;
    const ate = await api.eat().catch((error) => ({ ok: false, error: error.message }));
    if (ate.ok) event('ate', { food: ate.ate, hunger: bot.food });
  }
}
