// Till the earth beside open water and plant every seed carried; cut what is ripe and plant it
// again. args: { near: { x, y, z } } to make the plot by a place (where a player asked for it).
// When it has done something it takes a look at the plot with the player's own eyes: the
// skill's count is what it was told by the blocks it changed, and the look is what is there.
import { statSync } from 'node:fs';

export default async function farm({ bot, api, memory }, { near } = {}) {
  const done = await api.farm(near ?? memory.farmWanted ?? null);
  if (!done.ok) return { ok: false, note: done.error };
  let seen = '';
  try {
    const url = new URL('../eyes.mjs', import.meta.url);
    const eyes = await import(`${url.href}?v=${statSync(url).mtimeMs}`);
    const look = await eyes.look({ bot, memory, status: { doing: { skill: 'farm' } } },
      { at: { x: done.water.x, y: done.water.y, z: done.water.z }, tag: 'farm', turn: false, far: 24 });
    const there = look.told.remarks.filter((r) => /^(wheat|farmland|water)$/.test(r.name)).map((r) => `${r.name} ${Math.round(r.distance)} ${r.side}`);
    seen = `; seen: ${there.join(', ') || 'no wheat, farmland or water in view'} (${look.file.split('/').pop()})`;
  } catch (error) {
    seen = `; not looked at: ${String(error?.message ?? error).slice(0, 60)}`;
  }
  return { ok: true, note: `plot by the water at ${done.water.x} ${done.water.y} ${done.water.z}: tilled ${done.tilled}, planted ${done.planted}, cut ${done.cut}, ${done.growing} growing${seen}` };
}
