// Every creature the game has told the player about, however far, counted by kind with the nearest of each.
// args: { name: 'sheep' } to list places of one kind.
export default async function whoIsNear({ bot }, { name }) {
  const from = bot.entity.position;
  const all = Object.values(bot.entities).filter((e) => e !== bot.entity && e.position && e.name && !['item', 'arrow', 'experience_orb'].includes(e.name));
  if (name) {
    const these = all.filter((e) => e.name === name).sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from));
    return { ok: these.length > 0, note: `${these.length} ${name}: ${these.slice(0, 6).map((e) => `${Math.round(e.position.x)} ${Math.round(e.position.y)} ${Math.round(e.position.z)} (${Math.round(e.position.distanceTo(from))} away)`).join('; ')}` };
  }
  const kinds = {};
  for (const e of all) {
    const d = Math.round(e.position.distanceTo(from));
    const k = kinds[e.username ?? e.name] ??= { n: 0, nearest: d };
    k.n += 1;
    k.nearest = Math.min(k.nearest, d);
  }
  return { ok: true, note: Object.entries(kinds).sort((a, b) => a[1].nearest - b[1].nearest).map(([kind, k]) => `${k.n} ${kind} (${k.nearest})`).join(', ') };
}
