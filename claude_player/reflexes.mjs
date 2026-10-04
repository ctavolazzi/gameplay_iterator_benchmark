// What the player does without being asked. tick() runs four times a second, whether or
// not a skill is running. state lasts as long as the process; state.holdUntil keeps the
// brain and the queue from starting anything.
//
// Version 4 (turn 2). What each version learned, from the journal:
//   1  hit back while carrying on with the skill, run when hurt: 5 hits taken in 6 s with a
//      sword in the pack, then shot dead by a skeleton while running.
//   2  stop the skill and fight with the best weapon: killed a zombie (Monster Hunter), then
//      died to the next ones. Six zombies were within 20 blocks. Night in the open is the fault.
//   3  at dusk dig a hole and close it: survived the rest of that night at full health. But it
//      could not dig in from a treetop, where the world's spawn point is, and tried every 2 s.
//   4  the hole is dug in real ground found nearby; a failed try waits longer each time; a
//      fight starts only with something that can be seen; underground the night is for mining.

const WEAPONS = [/_sword$/, /_axe$/, /_pickaxe$/];

export async function tick({ bot, api, state, memory, busy, event, interrupt }) {
  const now = Date.now();
  const me = bot.entity.position;
  const foe = api.nearestHostile(12);
  const distance = foe ? foe.position.distanceTo(me) : Infinity;
  const health = +bot.health.toFixed(1);

  if (foe) {
    state.seen ??= {};
    if (!state.seen[foe.id]) {
      state.seen[foe.id] = now;
      event('encounter', { foe: foe.name, distance: +distance.toFixed(1), health, busy, night: api.night() });
    }
  }

  // A fight ends when the one being fought is no longer in the world, or has been lost.
  if (state.fight) {
    const target = bot.entities[state.fight.id];
    if (!target || target.position.distanceTo(me) > 14) {
      event('fight_over', { foe: state.fight.name, gone: !target, hits: state.fight.hits,
        seconds: Math.round((now - state.fight.started) / 1000), health });
      state.fight = null;
      bot.pathfinder.setGoal(null);
    }
  }

  const weapon = WEAPONS.map((kind) => api.find(kind)).find(Boolean) ?? null;
  const creeper = foe?.name === 'creeper';
  const enclosed = api.enclosed();
  const night = api.night();

  // In the closed hole nothing outside matters. Underground at night the brain may still mine.
  if (enclosed) {
    if (night && !state.sheltered) {
      state.sheltered = true;
      memory.home ??= api.round(me.offset(0, 3, 0));
      event('sheltered', { where: api.round(me), health, time: bot.time.timeOfDay });
    }
    state.fight = null;
    return eatIfHungry();
  }
  if (!night) state.sheltered = false;

  // Back away: from a creeper, or from anything when badly hurt with nothing to fight with.
  const mustFlee = foe && ((creeper && distance < 6) || (!weapon && bot.health <= 8 && distance < 8));
  if (mustFlee) {
    if (busy) interrupt(`backing away from a ${foe.name}`);
    if (!state.fleeing || now > state.fleeing) event('flee', { foe: foe.name, distance: +distance.toFixed(1), health });
    state.fleeing = now + 4000;
    state.holdUntil = now + 5000;
    state.fight = null;
  }
  if (state.fleeing && now < state.fleeing) {
    if (foe) bot.pathfinder.setGoal(new api.goals.GoalInvert(new api.goals.GoalFollow(foe, 16)), true);
    return;
  }
  if (state.fleeing) {
    state.fleeing = 0;
    if (!busy) bot.pathfinder.setGoal(null);
  }

  // Night under the open sky: into the ground, unless something is already in reach and there is
  // a weapon to answer it with. A failed try waits longer before the next.
  const beingHit = foe && !creeper && distance < 3.2 && weapon;
  if (night && api.exposed() && !beingHit && now > (state.nextDigIn ?? 0)) {
    state.fight = null;
    if (busy) interrupt('night: digging in');
    state.holdUntil = now + 20000;
    const dug = await api.digIn().catch((error) => ({ ok: false, error: error.message }));
    state.digFails = dug.ok ? 0 : (state.digFails ?? 0) + 1;
    state.nextDigIn = Date.now() + Math.min(60000, 2000 * 2 ** state.digFails);
    state.holdUntil = Date.now() + 1500;
    if (dug.ok || state.digFails <= 3) {
      event('dig_in', { ok: dug.ok, note: dug.note ?? dug.error, health: +bot.health.toFixed(1), where: api.round(bot.entity.position), time: bot.time.timeOfDay });
    }
    return;
  }

  // Fight what comes close and can be seen. The skill stops; nothing new starts until it is over.
  let target = state.fight ? bot.entities[state.fight.id] : null;
  if (!target && foe && !creeper && (distance < 2.5 || (distance < 5 && await api.canSee(foe)))) target = foe;
  if (target) {
    if (!state.fight) {
      if (busy) interrupt(`fighting a ${target.name}`);
      state.fight = { id: target.id, name: target.name, started: now, hits: 0 };
      event('fight', { foe: target.name, weapon: weapon?.name ?? 'hand', health, night });
    }
    state.holdUntil = now + 2500;
    if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand').catch(() => {});
    const reach = target.position.distanceTo(bot.entity.position);
    if (reach > 3) bot.pathfinder.setGoal(new api.goals.GoalFollow(target, 2), true);
    if (reach <= 3.4 && now - (state.lastHit ?? 0) > 600) {
      await bot.lookAt(target.position.offset(0, (target.height ?? 1.8) * 0.6, 0), true);
      bot.attack(target);
      state.fight.hits += 1;
      state.lastHit = now;
    }
    return;
  }

  return eatIfHungry();

  // Eat when hungry and nothing else is going on; when starving, stop the skill for it.
  async function eatIfHungry() {
    if (bot.food <= 6 && busy && now - (state.lastEat ?? 0) > 5000) interrupt('starving');
    // Health only comes back at 18 food or more (turn 3: sat at 8.5 health with 17 food and meat in the pack).
    if ((bot.food <= 14 || (bot.health < 20 && bot.food < 18)) && !busy && now - (state.lastEat ?? 0) > 5000) {
      state.lastEat = now;
      state.holdUntil = now + 3000;
      const ate = await api.eat().catch((error) => ({ ok: false, error: error.message }));
      if (ate.ok) event('ate', { food: ate.ate, hunger: bot.food });
    }
  }
}
