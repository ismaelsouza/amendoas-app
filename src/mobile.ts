import * as v from 'valibot';
import type { ArmazenamentoPedidos, PedidoLocal } from './order-sync.js';

type DadosLocais = Pick<Storage, 'getItem' | 'setItem'>;
const id = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4_294_967_295));
const uuid = v.pipe(v.string(), v.uuid());
const referencia = { vendaId: uuid, atualizadoEm: v.pipe(v.string(), v.isoTimestamp()) };
const itens = v.array(v.object({
  apresentacaoId: id, quantidade: v.pipe(v.string(), v.regex(/^\d{1,6}(\.\d{1,3})?$/)),
  precoUnitarioCentavos: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999_999_999)),
}));
const venda = v.object({ vendaId: uuid, clienteId: id, fechadoEm: v.pipe(v.string(), v.isoTimestamp()), itens });
const fechada = { ...referencia, clienteNome: v.string(), envio: venda };
const pedidosSalvos = v.array(v.variant('estado', [
  v.object({
    ...referencia, estado: v.literal('rascunho'),
    cliente: v.object({ id: v.nullable(id), nome: v.string() }),
    itens: v.array(v.object({ apresentacaoId: id, unidade: v.picklist(['pacote', 'caixa', 'kg']), quantidade: v.string() })),
  }),
  v.object({ ...fechada, estado: v.literal('aguardando_confirmacao') }),
  v.object({ ...fechada, estado: v.literal('confirmado'), numero: id }),
]));
const servidorFicticio = v.array(v.object({ vendaId: uuid, corpo: v.string() }));

export function armazenamentoNoAparelho(storage: DadosLocais, ambiente: string): ArmazenamentoPedidos {
  const chave = (vendedor: number) => `amendoas-v1:${ambiente}:vendedor:${vendedor}`;
  return {
    async carregar(vendedor) {
      const salvo = storage.getItem(chave(vendedor));
      if (salvo === null) return [];
      const dados = v.safeParse(pedidosSalvos, JSON.parse(salvo));
      if (!dados.success) throw new Error('Não foi possível abrir os pedidos locais.');
      return dados.output satisfies PedidoLocal[];
    },
    async salvar(vendedor, pedidos) {
      storage.setItem(chave(vendedor), JSON.stringify(pedidos));
    },
  };
}

export function sincronizarAoRetomar(eventos: EventTarget, sincronizar: () => Promise<unknown>): () => void {
  const retomar = () => { void sincronizar(); };
  const tipos = ['online', 'pageshow', 'amendoas:retomado'];
  for (const tipo of tipos) eventos.addEventListener(tipo, retomar);
  retomar();
  return () => { for (const tipo of tipos) eventos.removeEventListener(tipo, retomar); };
}

// O servidor fictício é separado da fila. A mesma venda recebe a confirmação original, mesmo após reabrir.
export function criarDemonstracao(storage: DadosLocais, opcoes: { online(): boolean; perderResposta(): boolean }) {
  const chave = 'amendoas-v1:servidor-ficticio';
  return async (_url: string, { body }: { body: string }) => {
    if (!opcoes.online()) throw new Error('Sem conexão.');
    const historico = v.parse(servidorFicticio, JSON.parse(storage.getItem(chave) ?? '[]'));
    const { vendaId } = v.parse(venda, JSON.parse(body));
    const indice = historico.findIndex((venda) => venda.vendaId === vendaId);
    if (indice >= 0 && historico[indice]?.corpo !== body) return { status: 409, async json() { return {}; } };
    const numero = indice < 0 ? historico.length + 1 : indice + 1;
    if (indice < 0) storage.setItem(chave, JSON.stringify([...historico, { vendaId, corpo: body }]));
    if (opcoes.perderResposta()) throw new Error('Resposta perdida após gravar.');
    return { status: indice < 0 ? 201 : 200, async json() { return { vendaId, numero }; } };
  };
}
