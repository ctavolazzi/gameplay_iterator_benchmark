// Get into the nearest bed at the first moment the game allows, then get up. No args.
// The proof that it slept is the game's Sweet Dreams advancement, not this skill's word.
export default async function sleep({ api }) {
  const done = await api.sleepInBed();
  return done.ok
    ? { ok: true, note: `got into the bed at ${done.at.x} ${done.at.y} ${done.at.z} at time ${done.time}` }
    : { ok: false, note: done.error };
}
