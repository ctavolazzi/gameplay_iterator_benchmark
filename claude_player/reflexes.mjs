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

  // Air first. Two of the first four deaths were drowning: 2 health a second, in a flooded
  // cave, while the skill went on digging. Under 10 of 20 breath: drop everything and swim up.
  const breath = bot.oxygenLevel ?? 20;
  // The last place it stood with a full breath is the way out of any water.
  if (breath >= 20 && bot.entity.onGround && !api.wetAt(me.offset(0, 1.6, 0)) && !api.wetAt(me)) state.airSpot = me.clone();
  // After a death by drowning the breath reading stays low until the game corrects it: only
  // believe it with the head actually under water.
  const headIn = bot.blockAt(me.offset(0, 1.6, 0))?.name ?? '';
  const underWater = /water|bubble_column|kelp|seagrass/.test(headIn);
  if (breath < 8 && underWater) {
    if (!state.surfacing) {
      state.surfacing = now;
      if (busy) interrupt('out of breath');
      event('surfacing', { breath, health, where: api.round(me), airSpot: state.airSpot ? api.round(state.airSpot) : null });
    }
    // Turn 4: swimming straight up did not get it out (it drowned holding the jump key), and
    // holding the queue kept the walk out from starting. Walk to the remembered air instead.
    state.holdUntil = now + 2000;
    state.fight = null;
    // Death 12: the remembered place was one step into the river. The nearest place with the
    // head in air is now looked for in the world; the remembered one is the second choice.
    if (now - (state.airGoalAt ?? 0) > 3000) {
      state.airGoalAt = now;
      const air = api.airNear(10) ?? state.airSpot;
      if (air) bot.pathfinder.setGoal(new api.goals.GoalNear(air.x, air.y, air.z, 0));
      else bot.setControlState('jump', true);
    }
    return;
  }
  if (state.surfacing) {
    if (breath < 16 && underWater) { state.holdUntil = now + 1500; return; }
    event('breathing', { breath, health, seconds: Math.round((now - state.surfacing) / 1000), where: api.round(me) });
    state.surfacing = 0;
    bot.setControlState('jump', false);
  }

  const weapon = WEAPONS.map((kind) => api.find(kind)).find(Boolean) ?? null;
  const creeper = foe?.name === 'creeper';
  const enclosed = api.enclosed() || api.snug();
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
  // Version 5 (turn 3): never a fist fight. With nothing to fight with it took 5 hits from one
  // zombie at dawn and landed nothing that mattered. No weapon means keeping away.
  // memory.brave: with nothing to lose and something to fetch, keep going past what would be run from.
  // Turn 7: brave was set by hand for a fetch and it stopped the player backing away from a
  // creeper, which blew up it, its bed and part of its base. A creeper is always backed away from.
  // And only a sword or an axe counts as something to fight with: a pickaxe does not.
  const brave = (memory.brave ?? 0) > now;
  const armed = !!(api.find(/_sword$/) ?? api.find(/_axe$/));
  const mustFlee = foe && ((creeper && distance < 6) || (!brave && !armed && distance < 10));
  if (mustFlee) {
    if (busy) interrupt(`backing away from a ${foe.name}`);
    if (!state.fleeing || now > state.fleeing) event('flee', { foe: foe.name, distance: +distance.toFixed(1), health });
    state.fleeing = now + 6000;
    state.holdUntil = now + 7000;
    state.fight = null;
  }
  if (state.fleeing && now < state.fleeing) {
    // Turn 7: backing away by pathfinder did not get away. On this machine the path is still
    // being thought about while the zombie arrives: eight deaths in 131 s, about 7 hits each, mostly standing.
    // Running needs no path: face away, hold forward, sprint and jump. A zombie walks at less
    // than half a sprint. If a second of running has not moved it, it turns a third of the way round.
    if (foe) {
      bot.pathfinder.setGoal(null);
      const away = me.minus(foe.position);
      away.y = 0;
      const length = Math.hypot(away.x, away.z) || 1;
      let [dx, dz] = [away.x / length, away.z / length];
      const stuck = state.fleeFrom && now - state.fleeFrom.at > 1000 && me.distanceTo(state.fleeFrom.where) < 1;
      if (!state.fleeFrom || now - state.fleeFrom.at > 1000) state.fleeFrom = { at: now, where: me.clone() };
      if (stuck) state.fleeTurn = (state.fleeTurn ?? 0) + Math.PI / 3;
      const turn = state.fleeTurn ?? 0;
      [dx, dz] = [dx * Math.cos(turn) - dz * Math.sin(turn), dx * Math.sin(turn) + dz * Math.cos(turn)];
      await bot.lookAt(me.offset(dx * 10, 1.6, dz * 10), true);
      bot.setControlState('forward', true);
      bot.setControlState('sprint', true);
      bot.setControlState('jump', true);
      if (distance > 24) state.fleeing = now;   // far enough: stop running, and let the night rule dig in
    }
    return;
  }
  if (state.fleeing) {
    state.fleeing = 0;
    state.fleeFrom = null;
    state.fleeTurn = 0;
    bot.clearControlStates();
    if (!busy) bot.pathfinder.setGoal(null);
  }

  // Night under the open sky: into the ground, unless something is already in reach and there is
  // a weapon to answer it with. A failed try waits longer before the next.
  // Turn 7: it logged in at night with a zombie 5 blocks off, began digging in, and was hit 16
  // times while it dug, in full iron armour with an iron sword in its pack: the dig-in runs to
  // its end inside one tick, and nothing else is looked at meanwhile. A hole is now begun only
  // with nothing hostile within 8 blocks, and is given up if something comes within 4.
  const beingHit = foe && !creeper && distance < 8;
  // memory.nightPass: the brain may ask for a short while in the open after dark, to finish a walk home.
  if (night && api.exposed() && !beingHit && now > (state.nextDigIn ?? 0) && now > (memory.nightPass ?? 0)) {
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
  if (!target && armed && foe && !creeper && (distance < 2.5 || (distance < 6 && await api.canSee(foe)))) target = foe;
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
