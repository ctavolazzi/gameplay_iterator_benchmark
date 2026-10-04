// Get into the nearest bed at the first moment the game allows, then get up. No args.
// The proof that it slept is the game's Sweet Dreams advancement, not this skill's word.
export default async function sleep({ api, memory, note }) {
  // In the base, the doorway and the middle of the roof are closed first: they are the two
  // ways in, and what comes in at night found the player twice (deaths 11 and 13).
  const base = memory.base;
  const before = base && api.Vec3 ? new api.Vec3(base.x, base.y, base.z) : null;
  const done = await api.sleepInBed(before ? async () => {
    let closed = 0;
    for (const [dx, dy, dz] of [[2, 0, 0], [2, 1, 0], [0, 2, 0]]) if (!api.solid(before.offset(dx, dy, dz)) && await api.fill(before.offset(dx, dy, dz))) closed += 1;
    if (closed) note(`closed ${closed} gaps before bed`);
  } : null);
  return done.ok
    ? { ok: true, note: `got into the bed at ${done.at.x} ${done.at.y} ${done.at.z} at time ${done.time}; up at ${done.upAt}` }
    : { ok: false, note: done.error };
}
