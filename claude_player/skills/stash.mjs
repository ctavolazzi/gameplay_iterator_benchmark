// Put the spares into the chest in the base, and take out junk that should never have gone in.
// args: { at: { x, y, z } }
export default async function stash({ api }, { at }) {
  if (!at) return { ok: false, note: 'say where the chest is' };
  const done = await api.stash(at);
  const list = (things) => Object.entries(things ?? {}).map(([name, n]) => `${n} ${name}`).join(', ');
  const told = [list(done.put) && `put in: ${list(done.put)}`, list(done.taken) && `taken out to throw away: ${list(done.taken)}`].filter(Boolean).join('; ');
  if (!done.ok) return { ok: false, note: `${done.error}${told ? ` (${told})` : ''}`.slice(0, 280) };
  return { ok: true, note: (told || 'nothing to put in').slice(0, 280) };
}
