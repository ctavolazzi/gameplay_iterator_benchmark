// Put on whatever armour is carried, and a shield in the other hand. No args.
export default async function wear({ api }) {
  const put = await api.wear();
  return put.length ? { ok: true, note: `put on ${put.join(', ')}` } : { ok: false, note: 'nothing to put on' };
}
