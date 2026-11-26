import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function armazenamentoEmDisco(diretorio) {
  return {
    async carregar(vendedorId) {
      try {
        return JSON.parse(await readFile(join(diretorio, `${vendedorId}.json`), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
    async salvar(vendedorId, pedidos) {
      const arquivo = join(diretorio, `${vendedorId}.json`);
      await writeFile(`${arquivo}.tmp`, JSON.stringify(pedidos), { mode: 0o600 });
      await rename(`${arquivo}.tmp`, arquivo);
    },
  };
}
