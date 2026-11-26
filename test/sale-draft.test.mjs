import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compararPrecosDoRascunho, conferirRascunho } from '../dist/sale-draft.js';

test('três pacotes usam o preço negociado e 750 g usam o preço por kg', () => {
  const pacotes = conferirRascunho([{ apresentacaoId: 1, unidade: 'pacote', quantidade: '3' }], {
    padrao: { 1: 2000 },
    cliente: { 1: 1875 },
  });
  assert.equal(pacotes.totalCentavos, 5625);

  const granel = conferirRascunho([{ apresentacaoId: 2, unidade: 'kg', quantidade: '0,750' }], {
    padrao: { 2: 2988 },
    cliente: {},
  });
  assert.equal(granel.totalCentavos, 2241);
  assert.equal(granel.itens[0].quantidade, '0.750');
});

test('mostra o subtotal anterior e o novo apenas para o preço que mudou', () => {
  const itens = [
    { apresentacaoId: 1, unidade: 'pacote', quantidade: '3' },
    { apresentacaoId: 2, unidade: 'kg', quantidade: '0,750' },
  ];
  const anterior = { padrao: { 1: 2000, 2: 2988 }, cliente: { 1: 1875 } };
  const atual = { padrao: { 1: 2100, 2: 3200 }, cliente: { 1: 1875 } };
  assert.deepEqual(compararPrecosDoRascunho(itens, anterior, atual), [{
    apresentacaoId: 2,
    anterior: { precoUnitarioCentavos: 2988, subtotalCentavos: 2241 },
    atual: { precoUnitarioCentavos: 3200, subtotalCentavos: 2400 },
  }]);
});

test('rascunho sem preço ou com pacote fracionado fica sem total para fechamento', () => {
  const precos = { padrao: { 1: 1875 }, cliente: {} };
  const pendentes = conferirRascunho([
    { apresentacaoId: 1, unidade: 'pacote', quantidade: '1,5' },
    { apresentacaoId: 2, unidade: 'kg', quantidade: '0,001' },
  ], precos);
  assert.equal(pendentes.totalCentavos, null);
  assert.equal(pendentes.itens[0].quantidade, null);
  assert.equal(pendentes.itens[1].precoUnitarioCentavos, null);
});

test('apresentações repetidas ficam em rascunho até as quantidades serem consolidadas', () => {
  const rascunho = conferirRascunho([
    { apresentacaoId: 1, unidade: 'pacote', quantidade: '2' },
    { apresentacaoId: 1, unidade: 'pacote', quantidade: '3' },
  ], { padrao: { 1: 1875 }, cliente: {} });
  assert.equal(rascunho.totalCentavos, null);
});
