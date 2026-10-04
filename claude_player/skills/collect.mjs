// Dig blocks of one kind and pick up what they drop.
// args: { block: 'log' | 'stone' | 'coal_ore' | ..., count: 1 }   'log' is any wood.
export default async function collect({ api, note }, { block = 'log', count = 1 }) {
  let got = 0;
  for (let i = 0; i < count; i++) {
    const one = await api.collectOne(block);
    if (!one.ok) {
      note(one.error);
      break;
    }
    got += 1;
  }
  return { ok: got === count, note: `picked up ${got} of ${count} ${block}` };
}
