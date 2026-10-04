// Smelt in the nearest furnace and take the result. args: { input: 'raw_iron', fuel: 'coal', count: 1 }
export default async function smelt({ api }, { input, fuel = 'coal', count = 1 }) {
  if (!input) return { ok: false, note: 'say what to smelt' };
  const done = await api.smelt(input, fuel, count);
  return done.ok
    ? { ok: true, note: `took out ${Object.entries(done.made).map(([name, n]) => `${n} ${name}`).join(', ')}` }
    : { ok: false, note: done.error ?? `only got ${JSON.stringify(done.made)}` };
}
