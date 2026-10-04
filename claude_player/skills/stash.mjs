// Put what is not needed on a trip into the chest in the base. args: { at: { x, y, z } }
export default async function stash({ api }, { at }) {
  if (!at) return { ok: false, note: 'say where the chest is' };
  const done = await api.stash(at);
  if (!done.ok) return { ok: false, note: done.error };
  const list = Object.entries(done.put).map(([name, n]) => `${n} ${name}`).join(', ');
  return { ok: true, note: list ? `put in the chest: ${list}`.slice(0, 280) : 'nothing to put in' };
}
