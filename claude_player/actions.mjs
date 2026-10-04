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
