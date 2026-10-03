import { prng } from '../prng.mjs';

// Players that are plain code. They exist to test the harness and to give a floor to
// compare a model against. A player is { id, decide() }; decide() gets the observation and
// the legal actions and returns { action }. Make a new player for every run: some keep state.

// Always the first action the game offers.
export function firstLegal() {
  return {
    id: 'scripted:first-legal',
    async decide({ actions }) {
      return { action: { name: actions[0].name } };
    },
  };
}

// A random legal action, from the player's own seeded stream.
export function seededRandom(seed) {
  const rng = prng(seed, 'player');
  return {
    id: `scripted:random:${seed}`,
    async decide({ actions }) {
      return { action: { name: actions[rng.int(actions.length)].name } };
    },
  };
}

// A fixed list of action names, legal or not. Past the end it repeats the last one.
export function fromList(names) {
  let i = 0;
  return {
    id: 'scripted:list',
    async decide() {
      const name = names[Math.min(i, names.length - 1)];
      i += 1;
      return { action: { name } };
    },
  };
}
