import type { FastifyInstance } from 'fastify';

const DEFAULT_INTERVAL_MS = 60_000;

/** Applies Home and Away schedule changes as they come due (ADR 0094). */
export function startHouseholdModeJob(
  app: FastifyInstance,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const changed = await app.runHouseholdModeSchedule();
      if (changed > 0)
        app.log.info(
          { households: changed },
          'Applied household mode schedule',
        );
    } catch (error) {
      app.log.error({ err: error }, 'Household mode schedule failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
