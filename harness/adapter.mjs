// The contract between the harness and a game. The harness calls only what is listed here,
// and nothing in harness/ may import from a game folder. A game lives in
// games/<name>/adapter.mjs and exports createAdapter() and defaults ({ seed, budget }).
//
//   name, version        which game and which build of it; stored on every run
//   reset({ seed, options })  put the game in its known start state for this seed
//   observe()            what the player can see now, as plain JSON
//   actions()            the actions possible now: [{ name, about }]
//   act(action)          apply { name, args }; returns { result, events }
//                        an event is { kind, detail, tick }; tick defaults to now
//   tick()               game time, an integer that never goes backwards
//   ended()              null while the game goes on, or the reason it stopped
//   metrics(log)         numbers for a finished run, worked out from its { steps, events }
//   describe()           the rules in words, for a player that reads
//   close()              release whatever reset() started
//   idle(phase)          optional. Called with 'start' when the player begins to think and
//                        'stop' when it has chosen, for a game that shows on a screen and
//                        wants something to happen there meanwhile. Nothing may rest on it.
//
// reset, observe, actions, act and close may be async. Event kinds, milestone names and
// metric names are the game's own vocabulary; the harness stores them without reading them.

const METHODS = ['reset', 'observe', 'actions', 'act', 'tick', 'ended', 'metrics', 'describe', 'close'];

export function assertAdapter(adapter) {
  const missing = [];
  for (const key of ['name', 'version']) {
    if (typeof adapter?.[key] !== 'string' || !adapter[key]) missing.push(key);
  }
  for (const method of METHODS) {
    if (typeof adapter?.[method] !== 'function') missing.push(`${method}()`);
  }
  if (missing.length) throw new Error(`game adapter is missing: ${missing.join(', ')}`);
  return adapter;
}
