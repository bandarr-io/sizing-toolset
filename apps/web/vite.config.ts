import react from '@vitejs/plugin-react';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { constantsDevPlugin } from './constants-dev-plugin.ts';

/** D40: the local ECH price file is served in development only; never ship it in a build. */
function keepLocalDataOutOfBuilds(): Plugin {
  let outDir = 'dist';
  return {
    name: 'keep-local-data-out-of-builds',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() { rmSync(join(outDir, 'ech-data.local.json'), { force: true }); },
  };
}

export default defineConfig({
  plugins: [react(), constantsDevPlugin(), keepLocalDataOutOfBuilds()],
  server: { port: 5173 },
});
