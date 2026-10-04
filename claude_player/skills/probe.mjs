// A look at what the game's recipe book says. args: { item }
export default async function probe({ bot }, { item }) {
  const it = bot.registry.itemsByName[item];
  const all = bot.recipesAll(it.id, null, true).map((r) => {
    const uses = {};
    for (const d of r.delta) if (d.count < 0) { const n = bot.registry.items[d.id].name; uses[n] = (uses[n] ?? 0) - d.count; }
    return `${JSON.stringify(uses)} makes ${r.result.count}${r.requiresTable ? ' table' : ''}`;
  });
  return { ok: true, note: `${all.length} recipes: ${all.slice(0, 14).join(' | ')}`.slice(0, 1500) };
}
