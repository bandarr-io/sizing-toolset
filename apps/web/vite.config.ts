import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { constantsDevPlugin } from './constants-dev-plugin.ts';

export default defineConfig({
  plugins: [react(), constantsDevPlugin()],
  server: { port: 5173 },
});
