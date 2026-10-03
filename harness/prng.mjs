import { createHash } from 'node:crypto';

// Seeds are strings everywhere. A Minecraft seed is a 64-bit integer, which a JavaScript
// number cannot hold exactly, so a seed is never parsed as a number.
function seedToInt(seed, salt) {
  return createHash('sha256').update(`${seed}|${salt}`).digest().readUInt32LE(0);
}

// A small deterministic generator (mulberry32). Nothing inside a run may call Math.random.
// The salt gives independent streams from one seed: a world's map and its dice, say.
export function prng(seed, salt = '') {
  let a = seedToInt(seed, salt);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n) };
}
