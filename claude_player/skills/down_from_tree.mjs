// Get down out of a treetop by digging the trunk away from under the feet. No args.
export default async function downFromTree({ api }) {
  const done = await api.downFromTree();
  return done.ok ? { ok: true, note: `on the ground, with ${done.logs} logs dug on the way` } : { ok: false, note: done.error };
}
