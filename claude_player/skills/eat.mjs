// Eat the best food carried. No args.
export default async function eat({ api }) {
  const ate = await api.eat();
  return ate.ok ? { ok: true, note: `ate ${ate.ate}` } : { ok: false, note: ate.error };
}
