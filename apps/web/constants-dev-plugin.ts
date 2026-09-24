import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { Constant } from '../../packages/constants/src/types.ts';
import { writeOverrides } from '../../packages/constants/scripts/write.ts';

const DATA_DIR = fileURLToPath(new URL('../../packages/constants/data', import.meta.url));
const MAX_BODY = 1_000_000;

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Dev-server only: lets the Configurations page write overrides into packages/constants/data/*.json.
 * Absent from production builds. File choice and validation happen here, never in the browser.
 */
export function constantsDevPlugin(): Plugin {
  return {
    name: 'sizing-constants-dev-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__constants/status', (_req, res) => send(res, 200, { writable: true, dataDir: 'packages/constants/data' }));
      server.middlewares.use('/__constants/write', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { ok: false, errors: ['POST only'] });
        // Only the app itself may write: reject cross-origin requests from other pages in the browser.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { ok: false, errors: ['Cross-origin write refused'] });
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
          return send(res, 415, { ok: false, errors: ['Content-Type must be application/json'] });
        }
        try {
          const body = JSON.parse(await readBody(req)) as { overrides?: unknown };
          if (!Array.isArray(body.overrides)) return send(res, 400, { ok: false, errors: ['Expected { overrides: Constant[] }'] });
          const result = writeOverrides(DATA_DIR, body.overrides as Constant[], localToday());
          server.config.logger.info(`[constants] write ${result.ok ? 'ok' : 'rejected'}: ${result.ok ? result.written.join(', ') || 'no changes' : result.errors.join('; ')}`);
          return send(res, result.ok ? 200 : 400, result);
        } catch (e) {
          return send(res, 400, { ok: false, errors: [e instanceof Error ? e.message : String(e)] });
        }
      });
    },
  };
}
