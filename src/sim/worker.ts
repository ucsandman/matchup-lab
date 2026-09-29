// worker_threads entry for the match runner (runner.ts). Receives {job, block} messages, plays the
// block with runBlock and posts the BlockResult back; an error is posted as {error}. Loaded as
// worker.ts under node --import tsx (the runner adds the tsx loader to the worker's execArgv) and
// as worker.js from dist/ after npm run build.
import { parentPort } from 'node:worker_threads';
import { runBlock, type Block, type MatchJob } from './games.js';

if (!parentPort) throw new Error('sim/worker.ts must run in a worker thread');
const port = parentPort;
port.on('message', (msg: { job: MatchJob; block: Block }) => {
  try {
    port.postMessage({ result: runBlock(msg.job, msg.block) });
  } catch (e) {
    port.postMessage({ error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
});
