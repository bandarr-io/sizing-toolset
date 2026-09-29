import { migrate } from './migrate.ts';
import type { AppState } from './state.ts';

/**
 * Share a scenario as a link: the scenario's JSON, compressed (deflate-raw) and base64url-encoded, in the
 * address after `#/?s=`. Only the scenario travels: settings changed on the Configurations page, cost prices
 * and Elastic Cloud price data stay in the sender's browser (the Elastic Cloud prices are local only, D40).
 */

export interface Codec {
  compress(bytes: Uint8Array): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<Uint8Array>;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** The browser's own deflate-raw (CompressionStream), also available in Node. */
export const streamCodec: Codec = {
  compress: (b) => through(b, new CompressionStream('deflate-raw')),
  decompress: (b) => through(b, new DecompressionStream('deflate-raw')),
};

const PARAM = 's';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

/** The scenario as the text that goes after `#/?s=`. */
export async function encodeScenario(s: AppState, codec: Codec = streamCodec): Promise<string> {
  return toBase64Url(await codec.compress(new TextEncoder().encode(JSON.stringify(s))));
}

/** The scenario a link carries, brought up to date by migrate(); undefined for anything that is not one. */
export async function decodeScenario(data: string, codec: Codec = streamCodec): Promise<AppState | undefined> {
  try {
    const json = new TextDecoder().decode(await codec.decompress(fromBase64Url(data)));
    return migrate(JSON.parse(json));
  } catch {
    return undefined;
  }
}

/** A full link to the calculator page carrying the scenario. */
export function shareUrl(data: string, loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}#/?${PARAM}=${data}`;
}

/** The shared scenario data in an address hash such as `#/?s=…`, if any. */
export function sharedParam(hash: string): string | undefined {
  const q = hash.indexOf('?');
  if (q < 0) return undefined;
  return new URLSearchParams(hash.slice(q + 1)).get(PARAM) ?? undefined;
}

/** The same hash without the shared scenario, keeping the page and any other parameters. */
export function withoutSharedParam(hash: string): string {
  const q = hash.indexOf('?');
  if (q < 0) return hash;
  const params = new URLSearchParams(hash.slice(q + 1));
  params.delete(PARAM);
  const rest = params.toString();
  return hash.slice(0, q) + (rest ? `?${rest}` : '');
}
