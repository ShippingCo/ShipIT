import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['test/contracts/attachments-s3.test.ts'],testTimeout:20000}});
