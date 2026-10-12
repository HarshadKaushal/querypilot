const { config } = require('dotenv');
const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../../..');
config({ path: resolve(root, '.env'), quiet: true });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to migrate');
  process.exit(1);
}

execSync('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: process.env,
  cwd: resolve(__dirname, '..'),
});
