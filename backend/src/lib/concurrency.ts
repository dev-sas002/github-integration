/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Syncing one repository at a time is needlessly slow; syncing all of them at
 * once burns the hourly GitHub quota in seconds and trips the secondary rate
 * limiter. A small fixed pool is the honest middle.
 */
export const mapWithConcurrency = async <TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> => {
  if (items.length === 0) {
    return [];
  }

  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<TOut>(items.length);
  let cursor = 0;

  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, runner));

  return results;
};
