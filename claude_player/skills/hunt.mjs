// Chase down one animal and pick up what it leaves. args: { animal: 'cow' | 'pig' | 'sheep' | 'chicken' }
export default async function hunt({ api }, { animal }) {
  if (!animal) return { ok: false, note: 'say which animal' };
  const done = await api.hunt(animal);
  return done.ok
    ? { ok: true, note: `${done.hits} hits; got ${Object.entries(done.gained).map(([name, n]) => `${n} ${name}`).join(', ') || 'nothing'}` }
    : { ok: false, note: done.error };
}
