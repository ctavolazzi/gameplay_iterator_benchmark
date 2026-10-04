// Set one thing in the player's memory by hand. args: { key: 'heading', value: 'east' }
export default async function remember({ memory }, { key, value }) {
  if (!key) return { ok: false, note: 'say which key' };
  memory[key] = value;
  return { ok: true, note: `${key} is now ${JSON.stringify(value)}` };
}
