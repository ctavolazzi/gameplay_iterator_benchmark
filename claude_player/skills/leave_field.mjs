// Out of the farm or the storehouse by its gate or door, and the gate shut behind
// (land.mjs insideOf() says whether the player is in one, and where the way out is).
// For when a task in there was cut short. No args.
import { statSync } from 'node:fs';

const load = (file) => { const url = new URL(file, import.meta.url); return import(`${url.href}?v=${statSync(url).mtimeMs}`); };

export default async function leaveField({ bot, api, memory }) {
  const { insideOf } = await load('../land.mjs');
  const pen = insideOf(memory, bot.entity.position.floored());
  if (!pen) return { ok: true, note: 'not inside the farm or the storehouse' };
  const vec = (cell) => new api.Vec3(cell.x, cell.y, cell.z);
  const out = await api.through(vec(pen.barrier), vec(pen.from), vec(pen.to));
  const still = insideOf(memory, bot.entity.position.floored());
  return { ok: out && !still, note: still ? `still inside the ${pen.kind}` : `out of the ${pen.kind} by its ${pen.kind === 'farm' ? 'gate' : 'door'}` };
}
