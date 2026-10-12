const { config } = require('dotenv');
const { execSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../../..');
config({ path: resolve(root, '.env'), quiet: true });
process.env.DATABASE_URL ||= 'postgresql://ayd:ayd@localhost:5434/ayd';

execSync('npx prisma generate', {
  stdio: 'inherit',
  env: process.env,
  cwd: resolve(__dirname, '..'),
});
