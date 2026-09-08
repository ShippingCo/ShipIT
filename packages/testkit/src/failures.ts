export type FailurePoint = 'none' | 'failure-before-commit' | 'commit-then-timeout';
export class InjectedFailure extends Error {
  readonly point: Exclude<FailurePoint, 'none'>;
  constructor(point: Exclude<FailurePoint, 'none'>) {
    super(point);
    this.name = 'InjectedFailure';
    this.point = point;
  }
}
// commit must resolve only after durable commit; this helper does not emulate SQL.
export async function atCommitBoundary<T>(point: FailurePoint, commit: () => Promise<T>): Promise<T> {
  if (point === 'failure-before-commit') throw new InjectedFailure(point);
  const result = await commit();
  if (point === 'commit-then-timeout') throw new InjectedFailure(point);
  return result;
}
export function createStaleVersionFixture(expected = 1) {
  if (!Number.isSafeInteger(expected) || expected < 1 || expected >= Number.MAX_SAFE_INTEGER) {
    throw new Error('FIXTURE_VERSION_OUT_OF_RANGE');
  }
  return { expected_version: expected, actual_version: expected + 1 };
}
