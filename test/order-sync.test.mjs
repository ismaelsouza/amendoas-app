import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { criarEnvioPedidos, PedidosOffline } from '../dist/order-sync.js';
import { armazenamentoEmDisco } from './support/file-order-store.mjs';

const sessao = { vendedorId: 2, token: 'sessao-ficticia' };
const cliente = { id: 1, nome: 'Supermercado Ipê' };
const itens = [{ apresentacaoId: 1, unidade: 'pacote', quantidade: '10' }];
const precos = { padrao: { 1: 1900 }, cliente: { 1: 1875 } };
const fechadoEm = '2026-11-26T18:00:00.000Z';
const url = 'https://adm.example';

async function ambiente(t, buscar) {
  const dir = await mkdtemp(join(tmpdir(), 'amendoas-app-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const abrir = (vendedorId = sessao.vendedorId, armazenamento = armazenamentoEmDisco(dir)) => new PedidosOffline({
    vendedorId, armazenamento, gerarId: randomUUID, agora: () => new Date(fechadoEm),
    enviar: criarEnvioPedidos(url + '/', buscar),
  });
  return { abrir, dir };
}

test('recupera vários rascunhos offline e não fecha sem vínculo e preço', async (t) => {
  const { abrir } = await ambiente(t, () => assert.fail('rascunhos não fazem requisições'));
  const app = abrir();
  const [primeiro, segundo] = await Promise.all([
    app.criarRascunho({ cliente: { id: null, nome: 'Mercado Novo' }, itens }),
    app.criarRascunho({ cliente, itens: [] }),
  ]);
  const reaberto = abrir();
  const restaurados = await reaberto.listar();
  assert.equal(restaurados.length, 2);
  assert.deepEqual(restaurados.find((p) => p.vendaId === primeiro.vendaId), primeiro);
  assert.equal(primeiro.atualizadoEm, fechadoEm);
  assert.deepEqual(await reaberto.sincronizar(sessao), []);
  await assert.rejects(reaberto.prepararEnvio(primeiro.vendaId, precos), /cliente/i);
  await reaberto.salvarRascunho(primeiro.vendaId, { cliente, itens });
  await assert.rejects(reaberto.prepararEnvio(primeiro.vendaId, { padrao: {}, cliente: {} }), /preço/i);
  const pronto = await reaberto.prepararEnvio(primeiro.vendaId, precos);
  assert.equal(pronto.estado, 'aguardando_confirmacao');
  assert.equal(pronto.envio.fechadoEm, fechadoEm);
  assert.equal(pronto.envio.itens[0].precoUnitarioCentavos, 1875);
  await assert.rejects(reaberto.salvarRascunho(primeiro.vendaId, { cliente, itens: [] }), /edição/i);
  assert.deepEqual((await abrir().listar()).find((p) => p.vendaId === segundo.vendaId), segundo);
});

test('perda da resposta deixa o pedido consultável e o reenvio recupera o número original', async (t) => {
  const envios = [];
  const numeros = new Map();
  const { abrir } = await ambiente(t, async (endereco, opcoes) => {
    assert.equal(endereco, url + '/api/v1/pedidos/campo');
    assert.equal(opcoes.method, 'POST');
    assert.equal(opcoes.headers.Authorization, `Bearer ${sessao.token}`);
    assert.equal(opcoes.headers['Content-Type'], 'application/json');
    envios.push(opcoes.body);
    const { vendaId } = JSON.parse(opcoes.body);
    const gravado = numeros.has(vendaId);
    if (!gravado) numeros.set(vendaId, numeros.size + 1);
    if (envios.length === 1) throw new Error('conexão perdida após gravar');
    return { status: gravado ? 200 : 201, json: async () => ({ vendaId, numero: numeros.get(vendaId) }) };
  });
  const app = abrir();
  const { vendaId } = await app.criarRascunho({ cliente, itens });
  const pronto = await app.prepararEnvio(vendaId, precos);
  assert.equal(envios.length, 0);
  assert.deepEqual(await app.sincronizar(sessao), [{ vendaId, estado: 'pendente', motivo: 'rede' }]);

  const reaberto = abrir();
  assert.deepEqual(await reaberto.listar(), [pronto]);
  assert.deepEqual(await reaberto.prepararEnvio(vendaId, { padrao: { 1: 9000 }, cliente: {} }), pronto);
  await Promise.all([reaberto.sincronizar(sessao), reaberto.sincronizar(sessao)]);
  assert.equal(envios.length, 2);
  assert.equal(envios[0], envios[1]);
  assert.deepEqual(await abrir().listar(), [{ ...pronto, estado: 'confirmado', numero: 1 }]);

  const segunda = await reaberto.criarRascunho({ cliente, itens });
  assert.notEqual(segunda.vendaId, vendaId);
  await reaberto.prepararEnvio(segunda.vendaId, precos);
  assert.deepEqual(await reaberto.sincronizar(sessao), [{ vendaId: segunda.vendaId, estado: 'confirmado', numero: 2 }]);
  assert.deepEqual([...numeros.values()], [1, 2]);
});

test('não altera o envio em rejeições HTTP ou confirmações inválidas e separa vendedores', async (t) => {
  const respostas = [
    { status: 401 },
    { status: 409 },
    { status: 200, json: async () => ({ vendaId: randomUUID(), numero: 3 }) },
    { status: 200, json: async () => { throw new SyntaxError('JSON incompleto'); } },
    { status: 201, json: async () => ({ vendaId, numero: 0 }) },
  ];
  const corpos = [];
  const { abrir } = await ambiente(t, async (_url, opcoes) => {
    corpos.push(opcoes.body);
    return respostas.shift();
  });
  const app = abrir();
  const { vendaId } = await app.criarRascunho({ cliente, itens });
  const pronto = await app.prepararEnvio(vendaId, precos);
  assert.deepEqual(await abrir(3).listar(), []);
  await assert.rejects(app.sincronizar({ vendedorId: 3, token: 'outra-sessao' }), /vendedor/i);
  assert.equal(corpos.length, 0);
  assert.deepEqual(await app.sincronizar(sessao), [{ vendaId, estado: 'pendente', motivo: 'http', status: 401 }]);
  assert.deepEqual(await app.sincronizar(sessao), [{ vendaId, estado: 'pendente', motivo: 'http', status: 409 }]);
  for (let n = 0; n < 3; n++) {
    assert.deepEqual(await app.sincronizar(sessao), [{ vendaId, estado: 'pendente', motivo: 'confirmacao_invalida' }]);
  }
  assert.equal(new Set(corpos).size, 1);
  assert.deepEqual(await abrir().listar(), [pronto]);
});

test('ninguém envia uma venda que não foi gravada na fila local', async (t) => {
  const { abrir, dir } = await ambiente(t, () => assert.fail('o envio não foi gravado'));
  const armazenamento = armazenamentoEmDisco(dir);
  const app = abrir();
  const rascunho = await app.criarRascunho({ cliente, itens });
  const comFalha = abrir(sessao.vendedorId, {
    carregar: armazenamento.carregar,
    async salvar() { throw new Error('armazenamento indisponível'); },
  });
  await assert.rejects(comFalha.prepararEnvio(rascunho.vendaId, precos), /armazenamento/);
  assert.deepEqual(await app.sincronizar(sessao), []);
  assert.deepEqual(await app.listar(), [rascunho]);
});
