import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const app = new URL('../../', import.meta.url);
const saida = new URL('dist/android-homologacao/', app);
await build({
  entryPoints: [fileURLToPath(new URL('dist/tracking-ui.js', app))],
  bundle: true,
  format: 'esm',
  target: 'chrome92',
  outfile: fileURLToPath(new URL('acompanhamento.js', saida)),
});
const html = await readFile(new URL('web/index.html', app), 'utf8');
const embarcado = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-android-embarcado>')
  .replace(/^.*(?:name="apple-mobile-web-app-capable"|rel="manifest"|rel="apple-touch-icon").*\n/gm, '')
  .replace("worker-src 'self'; manifest-src 'self';", "worker-src 'none'; manifest-src 'none';");
await Promise.all([
  writeFile(new URL('index.html', saida), embarcado),
  copyFile(new URL('android/web/mobile.css', app), new URL('mobile.css', saida)),
]);
