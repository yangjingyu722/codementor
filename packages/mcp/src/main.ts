import { runStdio } from './stdio.js';

runStdio().catch((err: unknown) => {
  console.error('[codementor-mcp] fatal:', err);
  process.exit(1);
});
