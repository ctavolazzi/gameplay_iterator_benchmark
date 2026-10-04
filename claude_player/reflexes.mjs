// What the player does without being asked. Two parts, kept apart so that the first can be
// tested without a game:
//
//   decide(senses, state)   what to do, given what is sensed and what is remembered between
//                           ticks. It touches nothing: it returns the act, the events to
//                           journal, and the changes to state. tests/claude_reflexes.test.mjs
//                           holds it against the situations that killed the player.
//   tick(ctx)               senses the world, asks decide, and does what it says. It runs
//                           four times a second, whether or not a skill is running.
//
// The rules, in order. Each was bought by the death or the stall named beside it in NOTES.md:
//   1 air         out of breath with the head under water: go to the nearest air (deaths 4, 7, 9, 12)
//   2 shelter     closed in at night: nothing outside matters
//   3 run         from a creeper always; from anything else when there is no sword or axe (deaths 11, 13 to 20)
//   4 dig in      at night under the open sky with nothing hostile within 8 blocks (deaths 1 to 3, 10)
//   5 shield      up against whatever shoots, while it is out of reach
//   6 fight       what comes close and can be seen, with the best sword; given up after 6 s
//                 without a hit (death 21)
//   7 eat         when hungry and idle
//
// state lasts as long as the process. state.holdUntil keeps the brain and the queue from
// starting anything.

export const R = { breathLow: 8, breathOk: 16, creeper: 6, runFrom: 10, runFar: 24, digClear: 8,
  archerMax: 14, reach: 3.4, fightTouch: 2.5, fightStart: 6, fightLost: 14, giveUpMs: 6000 };

// senses: { now, health, food, breath, underWater, night, exposed, enclosed, busy, armed, shielded,
//           canEat, foe: { id, name, distance, visible } | null, archer: the same | null,
//           fightTarget: { distance } | null, pass: { night, brave }, where }
// Returns { act, shield, interrupt, hold, events: [[kind, detail]], set, danger, flags }.
export function decide(s, st) {
  const out = { act: { kind: 'none' }, shield: null, interrupt: null, hold: 0, events: [], set: {}, danger: null, flags: {} };
  const foe = s.foe;
  const creeper = foe?.name === 'creeper';
  const pass = s.pass ?? {};
  const say = (kind, detail) => out.events.push([kind, detail]);
  const stop = (reason) => { if (s.busy) out.interrupt = reason; };

  if (foe && !st.seen?.[foe.id]) {
    out.set.seen = { ...(st.seen ?? {}), [foe.id]: s.now };
    say('encounter', { foe: foe.name, distance: +foe.distance.toFixed(1), health: s.health, busy: s.busy, night: s.night });
    // Cave spiders come from a spawner in a mineshaft and keep coming: the place is left alone.
    if (foe.name === 'cave_spider') out.danger = { r: 32, why: 'cave spiders' };
  }

  // A fight ends when the one being fought is no longer in the world, or has been lost.
  let fight = st.fight ?? null;
  if (fight && (!s.fightTarget || s.fightTarget.distance > R.fightLost)) {
    say('fight_over', { foe: fight.name, gone: !s.fightTarget, hits: fight.hits, seconds: Math.round((s.now - fight.started) / 1000), health: s.health });
    fight = null;
    out.set.fight = null;
    out.flags.clearGoal = true;
  }

  // 1 air. The reading stays low after a death by drowning, so it counts only under water.
  if (s.breath < R.breathLow && s.underWater) {
    if (!st.surfacing) {
      out.set.surfacing = s.now;
      stop('out of breath');
      say('surfacing', { breath: s.breath, health: s.health, where: s.where });
    }
    out.set.fight = null;
    out.hold = 2000;
    out.act = { kind: 'surface' };
    return out;
  }
  if (st.surfacing) {
    if (s.breath < R.breathOk && s.underWater) { out.hold = 1500; out.act = { kind: 'surface' }; return out; }
    say('breathing', { breath: s.breath, health: s.health, seconds: Math.round((s.now - st.surfacing) / 1000), where: s.where });
    out.set.surfacing = 0;
    out.flags.stopSwimming = true;
  }

  // 2 shelter.
  if (s.enclosed) {
    if (s.night && !st.sheltered) {
      out.set.sheltered = true;
      out.flags.rememberHome = true;
      say('sheltered', { where: s.where, health: s.health });
    }
    out.set.fight = null;
    return eat(s, st, out);
  }
  if (!s.night && st.sheltered) out.set.sheltered = false;

  // 3 run. A pass for being brave covers everything but creepers: it was once set to get the
  // player past zombies to its dropped things, and it walked it up to a creeper instead.
  const mustRun = foe && ((creeper && foe.distance < R.creeper) || (!pass.brave && !s.armed && foe.distance < R.runFrom));
  let running = st.fleeing ?? 0;
  if (mustRun) {
    stop(`backing away from a ${foe.name}`);
    if (!running || s.now > running) say('flee', { foe: foe.name, distance: +foe.distance.toFixed(1), health: s.health });
    running = s.now + 6000;
    out.set.fleeing = running;
    out.set.fight = null;
    out.hold = 7000;
  }
  if (running && s.now < running) {
    if (foe && foe.distance > R.runFar) out.set.fleeing = s.now;   // far enough: the night rule may dig in
    else if (foe) out.act = { kind: 'run', from: foe.id };
    return out;
  }
  if (st.fleeing) {
    out.set.fleeing = 0;
    out.flags.stopRunning = true;
  }

  // 4 dig in. Begun only with nothing hostile within 8 blocks: begun with a zombie 5 blocks
  // off, it was hit 16 times while it dug. tick() runs it beside the other rules and stops
  // it the moment one of them wants the player for something else.
  const tooClose = foe && !creeper && foe.distance < R.digClear;
  if (s.night && s.exposed && !tooClose && !pass.night && s.now > (st.nextDigIn ?? 0)) {
    stop('night: digging in');
    out.set.fight = null;
    out.hold = 20000;
    out.act = { kind: 'dig_in' };
    return out;
  }

  // 5 shield.
  const archer = s.archer;
  if (s.shielded && archer && archer.visible && archer.distance > R.reach && archer.distance < R.archerMax && !fight) {
    out.shield = 'up';
    if (st.blockedFor !== archer.id) say('shield_up', { foe: archer.name, distance: +archer.distance.toFixed(1), health: s.health });
    out.set.blockedFor = archer.id;
    out.act = { kind: 'face', id: archer.id };
  } else if (st.blocking) {
    out.shield = 'down';
  }

  // 6 fight. Only with a sword or an axe; a creeper is never fought.
  let begin = false;
  if (!fight && s.armed && foe && !creeper && (foe.distance < R.fightTouch || (foe.distance < R.fightStart && foe.visible))) {
    fight = { id: foe.id, name: foe.name, started: s.now, hits: 0 };
    begin = true;
    out.set.fight = fight;
    stop(`fighting a ${foe.name}`);
    say('fight', { foe: foe.name, health: s.health, night: s.night });
  }
  if (fight) {
    out.hold = 2500;
    if (!begin && s.now - Math.max(fight.started, fight.lastHitAt ?? 0) > R.giveUpMs) {
      say('fight_given_up', { foe: fight.name, hits: fight.hits, health: s.health, where: s.where });
      out.danger = { r: 28, why: `a ${fight.name} that could not be hit` };
      out.set.fight = null;
      out.set.fleeing = s.now + 6000;
      out.hold = 7000;
      out.act = { kind: 'none' };
      return out;
    }
    out.act = { kind: 'fight', id: fight.id };
    return out;
  }

  // 7 eat.
  return out.act.kind === 'none' ? eat(s, st, out) : out;
}

// Eat when hungry and nothing else is going on; when starving, stop the skill for it. Health
// only comes back at 18 food or more.
function eat(s, st, out) {
  const rested = s.now - (st.lastEat ?? 0) > 5000;
  if (s.food <= 6 && s.busy && rested && s.canEat) out.interrupt = 'starving';
  if ((s.food <= 14 || (s.health < 20 && s.food < 18)) && !s.busy && rested && s.canEat) {
    out.set.lastEat = s.now;
    out.hold = Math.max(out.hold, 3000);
    out.act = { kind: 'eat' };
  }
  return out;
}

const ARCHERS = /^(skeleton|stray|bogged|pillager)$/;

export async function tick({ bot, api, state, memory, busy, event, interrupt, makeApi }) {
  const now = Date.now();
  const me = bot.entity.position;
  const distanceTo = (e) => e.position.distanceTo(me);
  const sense = async (e, far) => (e ? { id: e.id, name: e.name, distance: distanceTo(e), visible: distanceTo(e) < far ? await api.canSee(e) : false } : null);

  const foeEntity = api.nearestHostile(12);
  const shielded = bot.inventory.slots[45]?.name === 'shield';
  const archerEntity = shielded ? bot.nearestEntity((e) => ARCHERS.test(e.name ?? '') && distanceTo(e) < R.archerMax) : null;
  const fightEntity = state.fight ? bot.entities[state.fight.id] : null;
  // The last place it stood with a full breath and its head out of water: the second choice
  // of a way out, after air found by looking.
  const breath = bot.oxygenLevel ?? 20;
  if (breath >= 20 && bot.entity.onGround && !api.wetAt(me.offset(0, 1.6, 0)) && !api.wetAt(me)) state.airSpot = me.clone();
  // A pass belongs to the step that is running: player.mjs sets it when the step starts and
  // clears it when the step ends. Nothing else writes it.
  const pass = memory.pass ?? {};

  const senses = {
    now, busy, pass, breath, where: api.round(me),
    health: +bot.health.toFixed(1), food: bot.food,
    underWater: api.wetAt(me.offset(0, 1.6, 0)),
    night: api.night(), exposed: api.exposed(), enclosed: api.enclosed() || api.snug(),
    armed: !!(api.bestOf('_sword') ?? api.bestOf('_axe')), shielded, canEat: api.hasFood(),
    foe: await sense(foeEntity, R.fightStart), archer: await sense(archerEntity, R.archerMax),
    fightTarget: fightEntity ? { distance: distanceTo(fightEntity) } : null,
  };
  const d = decide(senses, state);

  Object.assign(state, d.set);
  for (const [kind, detail] of d.events) event(kind, detail);
  if (d.interrupt) interrupt(d.interrupt);
  if (d.hold) state.holdUntil = Math.max(state.holdUntil ?? 0, now + d.hold);
  if (d.danger && !api.dangerous(me)) (memory.danger ??= []).push({ ...api.round(me), r: d.danger.r, until: now + 3600000, why: d.danger.why });
  if (d.flags.rememberHome) memory.home ??= api.round(me.offset(0, 3, 0));
  if (d.flags.clearGoal) bot.pathfinder.setGoal(null);
  if (d.flags.stopSwimming) bot.setControlState('jump', false);
  if (d.flags.stopRunning) { state.fleeFrom = null; state.fleeTurn = 0; bot.clearControlStates(); if (!busy) bot.pathfinder.setGoal(null); }

  // A dig-in runs beside the ticks. Anything else the rules want comes first: it is stopped.
  if (state.task && d.act.kind !== 'dig_in') {
    state.task.controller.abort(new Error('something more urgent'));
    try { bot.stopDigging(); } catch { /* not digging */ }
    state.task = null;
  }

  if (d.shield === 'up' && !state.blocking) { bot.activateItem(true); state.blocking = true; }
  if (d.shield === 'down' && state.blocking) { bot.deactivateItem(); state.blocking = false; }

  const act = d.act;
  if (act.kind === 'surface') {
    if (now - (state.airGoalAt ?? 0) > 3000) {
      state.airGoalAt = now;
      const air = api.airNear(10) ?? state.airSpot;
      if (air) bot.pathfinder.setGoal(new api.goals.GoalNear(air.x, air.y, air.z, 0));
      else bot.setControlState('jump', true);
    }
  } else if (act.kind === 'run') {
    // No path to think about: face away, hold forward, sprint and jump. If a second of running
    // has not moved it, it turns a third of the way round.
    const from = bot.entities[act.from];
    if (from) {
      bot.pathfinder.setGoal(null);
      const away = me.minus(from.position);
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
    }
  } else if (act.kind === 'dig_in') {
    if (!state.task) {
      const controller = new AbortController();
      const task = { kind: 'dig_in', controller };
      state.task = task;
      const digger = makeApi ? makeApi(controller.signal) : api;
      digger.digIn().catch((error) => ({ ok: false, error: error.message })).then((dug) => {
        if (state.task === task) state.task = null;
        if (controller.signal.aborted) return;   // stopped for something more urgent: not a failure of the digging
        state.digFails = dug.ok ? 0 : (state.digFails ?? 0) + 1;
        state.nextDigIn = Date.now() + Math.min(60000, 2000 * 2 ** state.digFails);
        state.holdUntil = Date.now() + 1500;
        if (dug.ok || state.digFails <= 3) {
          event('dig_in', { ok: dug.ok, note: dug.note ?? dug.error, health: +bot.health.toFixed(1), where: api.round(bot.entity.position), time: bot.time.timeOfDay });
        }
      });
    }
  } else if (act.kind === 'face') {
    const who = bot.entities[act.id];
    if (who) await bot.lookAt(who.position.offset(0, (who.height ?? 1.9) * 0.8, 0), true);
  } else if (act.kind === 'fight') {
    const target = bot.entities[act.id];
    const weapon = api.bestOf('_sword') ?? api.bestOf('_axe');
    if (target) {
      if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand').catch(() => {});
      const reach = distanceTo(target);
      if (reach > 3) bot.pathfinder.setGoal(new api.goals.GoalFollow(target, 2), true);
      if (reach <= R.reach && now - (state.lastHit ?? 0) > 600) {
        if (state.blocking) { bot.deactivateItem(); state.blocking = false; }
        await bot.lookAt(target.position.offset(0, (target.height ?? 1.8) * 0.6, 0), true);
        bot.attack(target);
        state.fight.hits += 1;
        state.fight.lastHitAt = now;
        state.lastHit = now;
      }
    }
  } else if (act.kind === 'eat') {
    const ate = await api.eat().catch((error) => ({ ok: false, error: error.message }));
    if (ate.ok) event('ate', { food: ate.ate, hunger: bot.food });
  }
}
