import * as chrono from 'chrono-node';

export interface DateRange {
  start: Date;
  end: Date;
}

export function parseTemporalFilter(filter: string): DateRange {
  const now = new Date();

  // Try chrono-node first
  const results = chrono.parse(filter, now, { forwardDate: false });

  if (results.length > 0) {
    const parsed = results[0];

    if (parsed.start && parsed.end) {
      return {
        start: parsed.start.date(),
        end: parsed.end.date(),
      };
    }

    if (parsed.start) {
      const start = parsed.start.date();
      // If just a point in time, create a window around it
      // If it's a relative reference like "last week", use start to now
      if (start < now) {
        return { start, end: now };
      }
      return { start: now, end: start };
    }
  }

  // Fallback: 30-day window
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start: thirtyDaysAgo, end: now };
}
