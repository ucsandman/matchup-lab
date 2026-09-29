// A persistent worker_threads pool for tools that run several rounds of blocks (the Phase 3 hand
// tool's sequential looks): workers start once and take {job, block} tasks from one queue, so a
// round does not pay the worker start-up again. Same worker entry and loader as runner.ts;
// workers = 0 runs every task in this thread. Results come back in task order.
import { Worker } from 'node:worker_threads';
import { workerSpec } from './runner.js';
import { runBlock, type Block, type BlockResult, type MatchJob } from './games.js';

export interface Task { job: MatchJob; block: Block }

export interface Pool {
  /** Worker threads (0: in-process). */
  readonly workers: number;
  run(tasks: readonly Task[]): Promise<BlockResult[]>;
  close(): Promise<void>;
}

export function createPool(workers: number): Pool {
  if (workers === 0) {
    return { workers: 0, run: async (tasks) => tasks.map((t) => runBlock(t.job, t.block)), close: async () => {} };
  }
  const { url, execArgv } = workerSpec();
  const threads: Worker[] = [];
  const ensure = (): void => {
    while (threads.length < workers) threads.push(new Worker(url, { execArgv }));
  };
  return {
    workers,
    run(tasks) {
      ensure();
      const out: BlockResult[] = new Array(tasks.length);
      if (tasks.length === 0) return Promise.resolve(out);
      return new Promise<BlockResult[]>((resolve, reject) => {
        let next = 0;
        let done = 0;
        let failed = false;
        const cleanups: (() => void)[] = [];
        const finish = (err?: unknown): void => {
          for (const c of cleanups) c();
          if (err !== undefined) reject(err);
          else resolve(out);
        };
        const feed = (w: Worker, slot: { at: number }): boolean => {
          if (next >= tasks.length) return false;
          slot.at = next++;
          w.postMessage(tasks[slot.at]);
          return true;
        };
        for (const w of threads) {
          const slot = { at: -1 };
          const onMessage = (msg: { result?: BlockResult; error?: string }): void => {
            if (failed) return;
            if (msg.error !== undefined || !msg.result) { failed = true; finish(new Error(`worker: ${msg.error ?? 'no result'}`)); return; }
            out[slot.at] = msg.result;
            done++;
            if (done === tasks.length) { finish(); return; }
            feed(w, slot);
          };
          const onError = (e: unknown): void => { if (!failed) { failed = true; finish(e); } };
          w.on('message', onMessage);
          w.on('error', onError);
          cleanups.push(() => { w.off('message', onMessage); w.off('error', onError); });
          feed(w, slot);
        }
      });
    },
    async close() {
      await Promise.all(threads.map((w) => w.terminate()));
      threads.length = 0;
    },
  };
}
