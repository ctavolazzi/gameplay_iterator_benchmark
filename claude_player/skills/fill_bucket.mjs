// Fill the empty bucket with water or lava that lies open, from the ground beside it.
// args: { liquid: 'water' | 'lava' }. The proof for lava is the game's Hot Stuff advancement.
export default async function fillBucket({ api }, { liquid = 'water' }) {
  if (!['water', 'lava'].includes(liquid)) return { ok: false, note: `no liquid called ${liquid}` };
  const done = await api.fillBucket(liquid);
  return done.ok ? { ok: true, note: `a bucket of ${liquid} from ${done.at.x} ${done.at.y} ${done.at.z}` } : { ok: false, note: done.error };
}
