import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarAcompanhamento } from '../dist/tracking.js';

test('acompanhamento usa o prefixo público, autentica a consulta e rejeita resposta inválida', async () => {
  const chamadas = [];
  const app = criarAcompanhamento('https://amendoas.example/api-amendoas-adm/', async (url, opcoes) => {
    chamadas.push([url, opcoes]);
    return Response.json({ pedidos: [{ numero: 18, cliente: 'Mercado Ipê', fechadoEm: '2026-11-26T12:00:00.000Z' }],
      proximoAntesDe: null });
  });
  const dados = await app.listar('token-piloto', 20);
  assert.equal(dados.success, true);
  assert.deepEqual(dados.data.pedidos.map((pedido) => pedido.numero), [18]);
  assert.equal(chamadas[0][0], 'https://amendoas.example/api-amendoas-adm/api/v1/pedidos/campo?antesDe=20');
  assert.equal(chamadas[0][1].headers.Authorization, 'Bearer token-piloto');
  assert.deepEqual(await app.entregas('token-piloto', 18), { success: false, error: 'resposta' });
});
