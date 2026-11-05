export function createGate(gapMs: number) {
  let next = 0;
  let chain = Promise.resolve();
  return function wait() {
    const run = chain.then(async () => {
      const now = Date.now();
      const start = Math.max(now, next);
      next = start + gapMs;
      const delay = start - now;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
