import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';

const saida = new URL('../dist/acompanhamento-web/', import.meta.url);
const css = new URL('../android/web/mobile.css', import.meta.url);
const arquivos = ['index.html', 'mobile.css', 'acompanhamento.js', 'manifest.webmanifest', 'icone-192.png', 'icone-512.png'];

function blocoPng(tipo, dados) {
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt32BE(dados.length);
  cabecalho.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabecalho.subarray(4), dados])));
  return Buffer.concat([cabecalho, dados, crc]);
}

function icone(tamanho) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(tamanho);
  cabecalho.writeUInt32BE(tamanho, 4);
  cabecalho[8] = 8;
  cabecalho[9] = 2;
  const larguraLinha = tamanho * 3 + 1;
  const pixels = Buffer.alloc(tamanho * larguraLinha);
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      const dx = (x + 0.5) / tamanho - 0.5;
      const dy = (y + 0.5) / tamanho - 0.5;
      const u = (dx - dy) / Math.SQRT2;
      const w = (dx + dy) / Math.SQRT2;
      const amendoa = (u / 0.28) ** 2 + (w / 0.115) ** 2 <= 1;
      const veio = Math.abs(w - 0.04 * Math.cos(u * 13)) < 0.008 && Math.abs(u) < 0.23;
      const cor = !amendoa ? [25, 60, 48] : veio ? [146, 91, 51] : [236, 197, 139];
      pixels.set(cor, y * larguraLinha + 1 + x * 3);
    }
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    blocoPng('IHDR', cabecalho), blocoPng('IDAT', deflateSync(pixels)), blocoPng('IEND', Buffer.alloc(0)),
  ]);
}

await Promise.all([
  copyFile(new URL('index.html', import.meta.url), new URL('index.html', saida)),
  copyFile(new URL('manifest.webmanifest', import.meta.url), new URL('manifest.webmanifest', saida)),
  copyFile(css, new URL('mobile.css', saida)),
  ...[192, 512].map((tamanho) => writeFile(new URL(`icone-${tamanho}.png`, saida), icone(tamanho))),
]);
const worker = await readFile(new URL('sw.js', import.meta.url), 'utf8');
const hash = createHash('sha256').update(worker);
for (const arquivo of arquivos) hash.update(await readFile(new URL(arquivo, saida)));
await writeFile(new URL('sw.js', saida), worker.replace('__REVISAO__', hash.digest('hex').slice(0, 16)));
