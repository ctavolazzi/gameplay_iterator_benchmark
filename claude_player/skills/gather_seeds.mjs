// Break grass until seeds are carried. args: { count: 1 }
export default async function gatherSeeds({ api }, { count = 1 }) {
  const done = await api.gatherSeeds(count);
  return done.ok ? { ok: true, note: `got ${done.got} wheat_seeds from ${done.broken} clumps of grass` } : { ok: false, note: done.error };
}
