import { createRequire } from 'node:module';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { PDF_FONTS } from '../../src/rom/romPdf.ts';

const require = createRequire(import.meta.url);
const FILES: Record<string, string> = {
  'Inter-400.woff': 'inter-latin-400-normal.woff', 'Inter-400i.woff': 'inter-latin-400-italic.woff', 'Inter-700.woff': 'inter-latin-700-normal.woff',
  'Inter-700i.woff': 'inter-latin-700-italic.woff', 'Inter-800.woff': 'inter-latin-800-normal.woff', 'Inter-800i.woff': 'inter-latin-800-italic.woff',
};

/** Renders a pdfmake definition in Node with the same Inter files the browser uses. */
export async function renderPdf(def: TDocumentDefinitions): Promise<Buffer> {
  const pdfmake = require('pdfmake');
  const path = (f: string) => require.resolve(`@fontsource/inter/files/${FILES[f]}`);
  const fonts = Object.fromEntries(Object.entries(PDF_FONTS).map(([family, styles]) => [family, Object.fromEntries(Object.entries(styles).map(([k, f]) => [k, path(f)]))]));
  pdfmake.setFonts(fonts);
  pdfmake.setLocalAccessPolicy((p: string) => p.includes('@fontsource'));
  pdfmake.setUrlAccessPolicy(() => false);
  return pdfmake.createPdf(def).getBuffer();
}
