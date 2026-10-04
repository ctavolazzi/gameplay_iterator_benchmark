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

// The score in the challenge, from the server's log. With { say: true } it is said in the game's chat.
export async function score(ctx, args = {}) {
  const score = await ctx.fresh('score.mjs');
  const result = score.read();
  const line = score.line(result);
  if (args.say) ctx.say(line, 'everyone');
  return { ok: true, line, since: result.since, score: result.score, rule: result.challenge.rule };
}
