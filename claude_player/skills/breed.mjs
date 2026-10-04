// Feed two animals that stand near each other so that they breed.
// args: { animal: 'chicken', food: 'wheat_seeds' }
export default async function breed({ api }, { animal = 'chicken', food = 'wheat_seeds' }) {
  const done = await api.breed(animal, food);
  return done.ok ? { ok: true, note: `fed 2 ${animal}s with ${food}` } : { ok: false, note: done.error };
}
