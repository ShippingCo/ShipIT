// CI distributes independent files across isolated PostgreSQL services. The
// default local command still runs both complete suites in their original order.
export const databaseShards = Object.freeze(['schema', 'api-1', 'api-2', 'api-3', 'api-4']);

export function databaseTestGroups(schemaFiles, apiFiles, args = []) {
  let shard;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--shard' || !databaseShards.includes(args[1])) {
      throw new Error('DB_TEST_SHARD_INVALID');
    }
    shard = args[1];
  }
  if (!schemaFiles.length || !apiFiles.length) throw new Error('DB_TEST_SUITE_EMPTY');
  const schema = { name: 'schema/DB', files: [...schemaFiles].sort() };
  const api = { name: 'API', files: [...apiFiles].sort() };
  if (!shard) return [schema, api];
  if (shard === 'schema') return [schema];
  const index = databaseShards.indexOf(shard) - 1;
  const files = api.files.filter((_, position) => position % (databaseShards.length - 1) === index);
  if (!files.length) throw new Error('DB_TEST_SUITE_EMPTY');
  return [{ name: `API ${shard}`, files }];
}
