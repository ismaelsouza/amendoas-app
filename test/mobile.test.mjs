import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { armazenamentoNoAparelho, criarDemonstracao, sincronizarAoRetomar } from '../dist/mobile.js';
import { criarEnvioPedidos, PedidosOffline } from '../dist/order-sync.js';

test('Android piloto conserva rascunho, recupera confirmação e isola vendedor', async () => {
  const dados = new Map();
  const storage = {
    getItem: (chave) => dados.get(chave) ?? null,
    setItem: (chave, valor) => dados.set(chave, valor),
  };
  let online = false;
  let perderResposta = false;
  let enviar = (venda, token) => criarEnvioPedidos('https://demo.example', criarDemonstracao(storage, {
    online: () => online,
    perderResposta: () => perderResposta,
  }))(venda, token);
  const lista = (vendedorId) => new PedidosOffline({
    vendedorId, armazenamento: armazenamentoNoAparelho(storage, 'demonstracao'), gerarId: randomUUID, enviar,
  });
  const sessao = { vendedorId: 1, token: 'demonstracao' };
  const dadosVenda = { cliente: { id: 1, nome: 'Supermercado Ipê' },
    itens: [{ apresentacaoId: 1, unidade: 'pacote', quantidade: '10' }] };
  const precos = { padrao: { 1: 1875 }, cliente: {} };
  const primeiro = await lista(1).criarRascunho(dadosVenda);
  await lista(1).criarRascunho({ ...dadosVenda, cliente: { id: null, nome: 'Outro mercado' } });
  assert.equal((await lista(1).listar())[0].itens[0].quantidade, '10');
  assert.deepEqual(await lista(2).listar(), []);
  await lista(1).prepararEnvio(primeiro.vendaId, precos);
  const eventos = new EventTarget();
  const atual = lista(1);
  let fim;
  const executar = () => { fim = atual.sincronizar(sessao); return fim; };
  const desligar = sincronizarAoRetomar(eventos, executar);
  assert.equal((await fim)[0].motivo, 'rede');
  online = true;
  perderResposta = true;
  eventos.dispatchEvent(new Event('online'));
  assert.equal((await fim)[0].motivo, 'rede');
  assert.equal((await lista(1).listar())[0].estado, 'aguardando_confirmacao');
  perderResposta = false;
  eventos.dispatchEvent(new Event('pageshow'));
  assert.deepEqual((await fim)[0], { vendaId: primeiro.vendaId, estado: 'confirmado', numero: 1 });
  const outro = await atual.criarRascunho(dadosVenda);
  await atual.prepararEnvio(outro.vendaId, precos);
  await executar();
  assert.deepEqual((await lista(1).listar()).map((pedido) => pedido.numero ?? pedido.estado), [1, 'rascunho', 2]);
  desligar();
});
