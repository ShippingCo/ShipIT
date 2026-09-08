// Deliberately fails until #10 supplies the real PostgreSQL runner and CI service.
console.error('Real PostgreSQL integration testing is intentionally not active until Issue #10.');
console.error('DB_TEST_RUNTIME_NOT_ACTIVE: required database tests cannot report success or skip.');
process.exitCode = 1;
