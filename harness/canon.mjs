import { createHash } from 'node:crypto';

// Canonical JSON: object keys sorted at every depth, so two equal values always produce
// the same text and the same hash, whatever order their keys were written in.
export function canon(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}
