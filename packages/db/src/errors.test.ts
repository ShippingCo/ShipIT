import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseError } from './errors.ts';

await test('database errors retain only reviewed unique index names and discard private driver fields', () => {
  for (const constraint of ['memberships_one_active_role_idx', 'invitations_one_pending_role_idx']) {
    const error = databaseError({ code: '23505', constraint, detail: 'private-synthetic-value',
      message: 'private-synthetic-value', table: 'private-synthetic-value', cause: 'private-synthetic-value' }, 'DB_QUERY_FAILED');
    assert.equal(error.constraint, constraint);
    assert.equal(error.sqlState, '23505');
    assert.equal(error.message, 'DB_QUERY_FAILED');
    assert.deepEqual(Object.keys(error).sort(), ['code', 'constraint', 'name', 'sqlState']);
    assert.doesNotMatch(JSON.stringify(error), /private-synthetic-value/);
    assert.equal(databaseError(error, 'DB_TRANSACTION_FAILED'), error);
  }
  for (const driver of [
    { code: '23505', constraint: 'membership_invitations_token_hash_key' },
    { code: '23505', constraint: 'private-synthetic-value' },
    { code: '23503', constraint: 'memberships_one_active_role_idx' },
    { code: '23505', message: 'memberships_one_active_role_idx' },
  ]) assert.equal(databaseError(driver, 'DB_QUERY_FAILED').constraint, undefined);
});
