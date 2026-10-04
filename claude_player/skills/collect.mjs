// Dig blocks of one kind and pick up what they drop.
// args: { block: 'log' | 'stone' | 'coal_ore' | ..., count: 1 }   'log' is any wood.
// ok when at least one was picked up; the note says how many of how many.
export default async function collect({ api, note }, { block = 'log', count = 1 }) {
  let got = 0;
  let why = null;
  for (let i = 0; i < count; i++) {
    const one = await api.collectOne(block);
    if (!one.ok) {
      why = one.error;
      note(one.error);
      break;
    }
    got += 1;
  }
  return { ok: got > 0, note: got > 0 ? `picked up ${got} of ${count} ${block}` : why };
}
