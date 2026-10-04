// Get out of bed. Reports whether the player was asleep, and whether it still is.
export default async function wake({ bot, api }) {
  const was = !!bot.isSleeping;
  let error = null;
  if (was) await bot.wake().catch((e) => { error = e.message; });
  await api.sleep(600);
  return { ok: !bot.isSleeping, note: `asleep before: ${was}; asleep now: ${!!bot.isSleeping}${error ? `; ${error}` : ''}` };
}
