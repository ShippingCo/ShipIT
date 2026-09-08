import { fixtureInstant } from './fixtures.ts';
export interface Clock { now(): Date }
export interface FakeClock extends Clock { set(instant: string | Date): void; advance(milliseconds: number): void }
export function createFakeClock(initial: string | Date = fixtureInstant): FakeClock {
  function parse(value: string | Date) {
    const next = value instanceof Date ? value.getTime() : Date.parse(value);
    if ((typeof value === 'string' && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) || !Number.isFinite(next)) {
      throw new Error('TEST_CLOCK_INVALID_INSTANT');
    }
    const canonical = (instant: string) => instant.replace(/\.([0-9]*?)0+Z$/, (_, digits: string) => digits ? `.${digits}Z` : 'Z');
    if (typeof value === 'string' && canonical(new Date(next).toISOString()) !== canonical(value)) {
      throw new Error('TEST_CLOCK_INVALID_INSTANT');
    }
    return next;
  }
  let current = parse(initial);
  return {
    now: () => new Date(current),
    set: (instant) => { current = parse(instant); },
    advance: (milliseconds) => {
      const next = current + milliseconds;
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || !Number.isFinite(new Date(next).getTime())) {
        throw new Error('TEST_CLOCK_INVALID_ADVANCE');
      }
      current = next;
    },
  };
}
