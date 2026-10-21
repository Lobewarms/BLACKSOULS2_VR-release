// Action tails use active gameplay time. New jobs never run recursively during
// the same flush, and every abandoned job releases its optional owned resources.
export class GameplayDelay {
  constructor({ onError = error => console.error('Delayed combat action failed', error) } = {}) {
    this.jobs = []; this.flushing = null; this.onError = onError;
  }
  schedule(milliseconds, run, { valid = () => true, cancel } = {}) {
    const job = { remaining: Number.isFinite(milliseconds) ? Math.max(0, milliseconds) / 1000 : 0, run, valid, cancel, done: false };
    this.jobs.push(job); return job;
  }
  discard(job) {
    if (job.done) return;
    job.done = true;
    try { job.cancel?.(); } catch (error) { this.onError(error); }
  }
  clear() {
    const jobs = new Set([...this.jobs, ...(this.flushing || [])]); this.jobs = [];
    for (const job of jobs) this.discard(job);
  }
  update(dt, paused = false) {
    if (this.flushing) return;
    const batch = this.jobs; this.jobs = []; this.flushing = batch;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    try {
      for (const job of batch) {
        if (job.done) continue;
        let valid = false;
        try { valid = !!job.valid(); } catch (error) { this.onError(error); }
        if (!valid) { this.discard(job); continue; }
        if (!paused && elapsed > 0) job.remaining -= elapsed;
        if (paused || elapsed <= 0 || job.remaining > 1e-9) { this.jobs.push(job); continue; }
        job.done = true;
        try { job.run(); } catch (error) { this.onError(error); }
      }
    } finally { this.flushing = null; }
  }
}
