// Get into bed at the first moment the game allows. If the night goes on because the others
// are awake, ask them three times in chat, then give up and get out again. No args.
// The proof that it slept is the game's Sweet Dreams advancement and the time on the clock,
// not this skill's word.
export default async function sleep({ bot, api, memory, note }) {
  // In the base, the doorway and the middle of the roof are closed first: they are the two
  // ways in, and what comes in at night found the player twice (deaths 11 and 13).
  const base = memory.base;
  const c = base ? new api.Vec3(base.x, base.y, base.z) : null;
  const closeUp = c ? async () => {
    let closed = 0;
    for (const [dx, dy, dz] of [[2, 0, 0], [2, 1, 0], [0, 2, 0]]) if (!api.solid(c.offset(dx, dy, dz)) && await api.fill(c.offset(dx, dy, dz))) closed += 1;
    if (closed) note(`closed ${closed} gaps before bed`);
  } : null;
  const say = (text) => { bot.chat(text); note(`said: ${text}`); };
  const done = await api.sleepInBed(closeUp, say);
  if (!done.ok) return { ok: false, note: done.error };
  if (done.gaveUp) {
    // No more bed tonight: the brain goes mining instead.
    const ticksLeft = (24000 - bot.time.timeOfDay + 200) % 24000;
    memory.noBedUntil = Date.now() + ticksLeft * 50;
    return { ok: true, note: `in bed at time ${done.time}; asked ${done.asked} times and the night went on; ${done.up ? 'got up' : 'could not get up'} at ${done.upAt}` };
  }
  return { ok: true, note: `in bed at time ${done.time}${done.asked ? `, asked ${done.asked} times` : ''}; up at ${done.upAt}` };
}
