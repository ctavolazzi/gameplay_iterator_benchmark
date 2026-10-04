// Till a block of earth with the hoe carried and plant a wheat seed in it. No args.
export default async function plantSeed({ api }) {
  const done = await api.plantSeed();
  return done.ok ? { ok: true, note: `wheat planted at ${done.at.x} ${done.at.y} ${done.at.z}` } : { ok: false, note: done.error };
}
