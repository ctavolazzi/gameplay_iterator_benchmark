// Take from the chest in the base what makes the player fit to go out again: better armour, a
// better pickaxe and sword, a shield, food, and diamonds for the diamond things it is without.
// args: { at: { x, y, z } }
export default async function kit({ api }, { at }) {
  if (!at) return { ok: false, note: 'say where the chest is' };
  const done = await api.kit(at);
  if (!done.ok) return { ok: false, note: done.error };
  const list = (things) => Object.entries(things).map(([name, n]) => `${n} ${name}`).join(', ');
  return { ok: true, note: (list(done.taken) ? `took ${list(done.taken)}; left in the chest: ${list(done.left) || 'nothing'}` : `nothing in the chest is better than what it has (${list(done.left) || 'empty'})`).slice(0, 280) };
}
