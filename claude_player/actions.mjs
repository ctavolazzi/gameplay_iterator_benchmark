// Things the player can be asked for over its control port that are not part of player.mjs,
// so that they can be added and changed while it plays. player.mjs loads this file again
// whenever it changes and calls the function with the action's name:
//   node claude_player/player.mjs look north --open
//   node claude_player/player.mjs score
// Each gets { bot, memory, status, event, fresh, say, stop, saveMemory, earned } and the arguments.

// A picture from the player's own eyes, and what is in it in words. See eyes.mjs.
export async function look(ctx, args = {}) {
  const eyes = await ctx.fresh('eyes.mjs');
  const seen = await eyes.look({ bot: ctx.bot, memory: ctx.memory, status: ctx.status }, args);
  ctx.event('looked', { file: seen.file, says: seen.says, ms: seen.ms, for: args.for ?? 'the session' });
  return seen;
}

// Follow a player until the time is up or it is told to stop: { player, seconds }. The order is
// the brain's to carry out, so a fight on the way does not end it. The plain `stop` action
// ends it, and so does "stop" in chat. For CT's menu in the game (tools/tab_board.mjs).
export async function follow(ctx, args = {}) {
  const player = String(args.player ?? '');
  if (!ctx.bot.players[player] || player === ctx.bot.username) throw new Error(`no other player called ${player} is in the game`);
  const seconds = Math.max(10, Math.min(3600, Number(args.seconds) || 600));
  ctx.memory.order = { kind: 'follow', player, until: Date.now() + seconds * 1000 };
  ctx.saveMemory();
  ctx.stop(`${player} asked`);
  ctx.event('order', { kind: 'follow', player, seconds });
  return { ok: true, following: player, seconds };
}

// Send the player to its bed for the rest of the night, as a person asking in chat does:
// { who }. It answers with what it said it would do. `resume` ends it.
export async function bed(ctx, args = {}) {
  const chat = await ctx.fresh('chat.mjs');
  const answer = chat.toBed({ bot: ctx.bot, memory: ctx.memory, who: String(args.who ?? 'the session'), stop: () => ctx.stop(`${args.who ?? 'the session'} asked`) });
  ctx.saveMemory();
  ctx.event('order', { kind: 'bed', who: args.who ?? 'the session', answer });
  if (args.say) ctx.say(answer, 'everyone');
  return { ok: true, answer, order: ctx.memory.order ?? null };
}

// End whatever it was told to do (follow, bed, wait, come) and let it go back to its own work.
export async function resume(ctx) {
  const had = ctx.memory.order?.kind ?? null;
  if (had === 'bed' || ctx.status().doing?.skill === 'sleep') (await ctx.fresh('chat.mjs')).noBedTonight(ctx.bot, ctx.memory);
  delete ctx.memory.order;
  ctx.saveMemory();
  const stopped = ctx.stop('asked to stop');
  ctx.event('order', { kind: 'resume', ended: had });
  return { ok: true, ended: had, stopped: stopped.stopped };
}

// The score in the challenge, from the server's log. With { say: true } it is said in the game's chat.
export async function score(ctx, args = {}) {
  const score = await ctx.fresh('score.mjs');
  const result = score.read();
  const line = score.line(result);
  if (args.say) ctx.say(line, 'everyone');
  return { ok: true, line, since: result.since, score: result.score, rule: result.challenge.rule };
}

// What stands where the bigger base is planned (blueprint.mjs), read from the world as the
// player knows it. Looks only. { steps } is how many stairs to look along.
export async function survey(ctx, args = {}) {
  const { hallPlan } = await ctx.fresh('blueprint.mjs');
  const lib = await ctx.fresh('lib.mjs');
  const base = ctx.memory.base;
  if (!base) throw new Error('no base remembered');
  const plan = hallPlan(base, Math.min(24, args.steps ?? 16));
  const at = ([x, y, z]) => ctx.bot.blockAt(new lib.Vec3(x, y, z));
  const count = (cells) => {
    const out = {};
    for (const cell of cells) { const name = at(cell)?.name ?? 'not loaded'; out[name] = (out[name] ?? 0) + 1; }
    return out;
  };
  const whole = (block) => !!block && block.boundingBox === 'block';
  const all = [...plan.interior, ...plan.shell, ...plan.entrance, ...plan.stairs.flatMap((s) => [s.floor, ...s.clear])];
  const notable = all.map((cell) => ({ cell, name: at(cell)?.name ?? '' }))
    .filter((b) => /water|lava|chest|_bed|crafting_table|furnace|_door|torch|ladder|_planks|_stairs|_slab|glass|fence|sign|barrel/.test(b.name));
  // How many stairs until the open sky: the first whose headroom is under nothing but air.
  let steps = null;
  for (const [j, stair] of plan.stairs.entries()) {
    const [x, y, z] = stair.clear[0];
    let open = true;
    for (let up = 0; up <= 40 && open; up++) if (whole(at([x, y + up, z])) && !/leaves|_log$/.test(at([x, y + up, z]).name)) open = false;
    if (open && !whole(at(stair.clear[2])) === false) { /* the stair itself is still rock: it is dug */ }
    if (open) { steps = j; break; }
  }
  return { ok: true, base, interior: count(plan.interior), shellGaps: plan.shell.filter((cell) => !whole(at(cell))).length, shell: plan.shell.length,
    entrance: plan.entrance.map((cell) => at(cell)?.name), stairs: plan.stairs.slice(0, 12).map((s, j) => `${j}: on ${at(s.floor)?.name}, through ${s.clear.map((cell) => at(cell)?.name).join('/')}`),
    stepsToSky: steps, notable: notable.slice(0, 30).map((b) => `${b.name} ${b.cell.join(' ')}`),
    players: Object.values(ctx.bot.players).filter((p) => p.entity && p.username !== ctx.bot.username).map((p) => `${p.username} ${Math.round(p.entity.position.x)} ${Math.round(p.entity.position.y)} ${Math.round(p.entity.position.z)}`) };
}

// The jobs of work on the land (skills/work.mjs): what is open and what is done.
export async function works(ctx) {
  return { ok: true, works: ctx.memory.works ?? [], field: ctx.memory.farmField ?? null };
}

// Give the player a job as a person in chat would: { kind: 'farm' | 'clear' | 'trees', by,
// near: { x, z }, standAt, radius }, or { say: 'the words' } to have land.mjs read them.
// { drop: id } takes one off the list. The brain does the first open one by day.
export async function job(ctx, args = {}) {
  ctx.memory.works ??= [];
  if (args.drop) {
    ctx.memory.works = ctx.memory.works.filter((w) => w.id !== args.drop);
    ctx.saveMemory();
    return { ok: true, works: ctx.memory.works };
  }
  const { asksFor } = await ctx.fresh('land.mjs');
  const asked = args.say ? asksFor(args.say) : [{ kind: args.kind, ...(Number.isInteger(args.standAt) && { standAt: args.standAt }) }];
  if (!asked.length || asked.some((a) => !['farm', 'clear', 'trees'].includes(a.kind))) throw new Error('say a kind (farm, clear or trees), or the words to read');
  const made = asked.map((a, i) => ({ id: `${Date.now().toString(36)}${i}`, ...a, by: String(args.by ?? 'the session'),
    ...(args.near && { near: { x: Math.round(args.near.x), z: Math.round(args.near.z) } }),
    ...(Number.isInteger(args.radius) && { radius: args.radius }),
    ...(args.site && { site: args.site }), ...(Number.isInteger(args.level) && { level: args.level }), asked: new Date().toISOString() }));
  ctx.memory.works.push(...made);
  ctx.saveMemory();
  ctx.event('order', { kind: 'work', jobs: made.map((w) => `${w.kind} ${w.id}`) });
  return { ok: true, added: made };
}
