// worker_threads entry for the spot analyzer (ismcts.ts searchViewParallel). workerData carries the
// view, the search options, the sample indices this worker searches and the number of parallel
// workers (for the time budget); it posts {results} or {error} once and exits.
import { parentPort, workerData } from 'node:worker_threads';
import '../cards/index.js';
import { searchIndices, type SearchOptions } from './ismcts.js';
import type { PlayerView } from '../engine/view.js';

if (!parentPort) throw new Error('agents/ismcts-worker.ts must run in a worker thread');
const port = parentPort;
const data = workerData as { view: PlayerView; opts: SearchOptions; indices: number[]; parallel: number };
try {
  port.postMessage({ results: searchIndices(data.view, data.opts, data.indices, data.parallel) });
} catch (e) {
  port.postMessage({ error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
}
