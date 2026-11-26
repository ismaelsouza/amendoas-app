import { conferirRascunho } from './sale-draft.js';
import type { ItemRascunho, Precos } from './sale-draft.js';

export type DadosRascunho = Readonly<{
  cliente: Readonly<{ id: number | null; nome: string }>;
  itens: readonly Readonly<ItemRascunho>[];
}>;

type ReferenciaLocal = Readonly<{ vendaId: string; atualizadoEm: string }>;
export type RascunhoLocal = ReferenciaLocal & DadosRascunho & { readonly estado: 'rascunho' };

export type VendaCampo = Readonly<{
  vendaId: string;
  clienteId: number;
  fechadoEm: string;
  itens: readonly Readonly<{
    apresentacaoId: number;
    quantidade: string;
    precoUnitarioCentavos: number;
  }>[];
}>;

type VendaFechada = ReferenciaLocal & Readonly<{ clienteNome: string; envio: VendaCampo }>;
type EnvioPendente = VendaFechada & { readonly estado: 'aguardando_confirmacao' };
type VendaConfirmada = VendaFechada & Readonly<{ estado: 'confirmado'; numero: number }>;
type EnvioLocal = EnvioPendente | VendaConfirmada;
export type PedidoLocal = RascunhoLocal | EnvioLocal;

/** O adaptador separa os vendedores e só resolve salvar após persistir atomicamente. */
export interface ArmazenamentoPedidos {
  carregar(vendedorId: number): Promise<readonly PedidoLocal[]>;
  salvar(vendedorId: number, pedidos: readonly PedidoLocal[]): Promise<void>;
}

export type SessaoVendedor = Readonly<{ vendedorId: number; token: string }>;
type ResultadoEnvio =
  | { estado: 'confirmado'; numero: number }
  | { estado: 'pendente'; motivo: 'rede' | 'confirmacao_invalida' }
  | { estado: 'pendente'; motivo: 'http'; status: number };
type TentativaEnvio = { vendaId: string } & ResultadoEnvio;
type EnviarPedido = (venda: VendaCampo, token: string) => Promise<ResultadoEnvio>;
type BuscarPedido = (url: string, opcoes: {
  method: 'POST'; headers: Record<string, string>; body: string;
  credentials: 'omit'; cache: 'no-store'; redirect: 'error'; signal: AbortSignal;
}) => Promise<{ status: number; json(): Promise<unknown> }>;

type OpcoesPedidos = {
  vendedorId: number;
  armazenamento: ArmazenamentoPedidos;
  gerarId: () => string;
  agora?: () => Date;
  enviar: EnviarPedido;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 4_294_967_295;
}

function copiarDados(dados: DadosRascunho): DadosRascunho {
  return { cliente: { ...dados.cliente }, itens: dados.itens.map((item) => ({ ...item })) };
}

function copiarPedido(pedido: PedidoLocal): PedidoLocal {
  if (pedido.estado === 'rascunho') return { ...pedido, ...copiarDados(pedido) };
  return copiarEnvio(pedido);
}

function copiarEnvio(pedido: EnvioLocal): EnvioLocal {
  const envio = { ...pedido.envio, itens: pedido.envio.itens.map((item) => ({ ...item })) };
  return { ...pedido, envio };
}

export function criarEnvioPedidos(baseUrl: string, buscar: BuscarPedido, encerrar?: AbortSignal): EnviarPedido {
  const url = baseUrl.replace(/\/+$/, '') + '/api/v1/pedidos/campo';
  return async (venda, token) => {
    if (encerrar?.aborted) return { estado: 'pendente', motivo: 'rede' };
    const controle = new AbortController();
    const abortar = () => controle.abort();
    encerrar?.addEventListener('abort', abortar, { once: true });
    const limite = setTimeout(abortar, 10_000);
    try {
      const resposta = await buscar(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(venda),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controle.signal,
      });
      if (resposta.status !== 200 && resposta.status !== 201) {
        return { estado: 'pendente', motivo: 'http', status: resposta.status };
      }
      const confirmacao = await resposta.json().catch(() => null);
      if (typeof confirmacao === 'object' && confirmacao !== null
        && 'vendaId' in confirmacao && confirmacao.vendaId === venda.vendaId
        && 'numero' in confirmacao && idValido(confirmacao.numero)) {
        return { estado: 'confirmado', numero: confirmacao.numero };
      }
      return { estado: 'pendente', motivo: 'confirmacao_invalida' };
    } catch {
      return { estado: 'pendente', motivo: 'rede' };
    } finally {
      clearTimeout(limite);
      encerrar?.removeEventListener('abort', abortar);
    }
  };
}

export class PedidosOffline {
  readonly #opcoes: Readonly<OpcoesPedidos>;
  #alteracoes: Promise<unknown> = Promise.resolve();
  #sincronizacoes: Promise<unknown> = Promise.resolve();

  constructor(opcoes: OpcoesPedidos) {
    if (!idValido(opcoes.vendedorId)) throw new Error('Vendedor inválido.');
    this.#opcoes = { ...opcoes };
  }

  async listar(): Promise<PedidoLocal[]> {
    await this.#alteracoes;
    return (await this.#carregar()).map(copiarPedido);
  }

  async criarRascunho(dados: DadosRascunho): Promise<RascunhoLocal> {
    const copia = copiarDados(dados);
    return this.#alterar(async () => {
      const pedidos = await this.#carregar();
      const vendaId = this.#opcoes.gerarId().toLowerCase();
      if (!uuid.test(vendaId) || pedidos.some((pedido) => pedido.vendaId === vendaId)) {
        throw new Error('Não foi possível gerar um identificador único para a venda.');
      }
      const pedido: RascunhoLocal = { estado: 'rascunho', vendaId, atualizadoEm: this.#agora(), ...copia };
      await this.#salvar([...pedidos, pedido]);
      return pedido;
    });
  }

  async salvarRascunho(vendaId: string, dados: DadosRascunho): Promise<RascunhoLocal> {
    const copia = copiarDados(dados);
    return this.#alterar(async () => {
      const pedidos = await this.#carregar();
      const pedido = this.#obter(pedidos, vendaId);
      if (pedido.estado !== 'rascunho') throw new Error('O pedido não está disponível para edição.');
      const atualizado = { ...pedido, ...copia, atualizadoEm: this.#agora() };
      await this.#substituir(pedidos, atualizado);
      return atualizado;
    });
  }

  async prepararEnvio(vendaId: string, precos: Precos): Promise<EnvioLocal> {
    const tabela = { padrao: { ...precos.padrao }, cliente: { ...precos.cliente } };
    return this.#alterar(async () => {
      const pedidos = await this.#carregar();
      const rascunho = this.#obter(pedidos, vendaId);
      if (rascunho.estado !== 'rascunho') return copiarEnvio(rascunho);

      const clienteId = rascunho.cliente.id;
      if (!idValido(clienteId)) throw new Error('Vincule o cliente antes de enviar o pedido.');
      const conferidos = conferirRascunho(rascunho.itens, tabela);
      if (conferidos.totalCentavos === null || conferidos.itens.length > 100) {
        throw new Error('Confira as quantidades, apresentações e preços antes de enviar o pedido.');
      }
      const itens = conferidos.itens.map(({ apresentacaoId, quantidade, precoUnitarioCentavos }) => {
        if (!idValido(apresentacaoId) || quantidade === null || precoUnitarioCentavos === null) {
          throw new Error('Confira as quantidades, apresentações e preços antes de enviar o pedido.');
        }
        return { apresentacaoId, quantidade, precoUnitarioCentavos };
      });
      const fechadoEm = this.#agora();
      const pendente: EnvioPendente = {
        estado: 'aguardando_confirmacao', vendaId, atualizadoEm: fechadoEm,
        clienteNome: rascunho.cliente.nome, envio: { vendaId, clienteId, fechadoEm, itens },
      };
      await this.#substituir(pedidos, pendente);
      return pendente;
    });
  }

  async sincronizar(sessao: SessaoVendedor): Promise<TentativaEnvio[]> {
    if (sessao.vendedorId !== this.#opcoes.vendedorId) throw new Error('A sessão pertence a outro vendedor.');
    const { token } = sessao;
    const execucao = this.#sincronizacoes.then(() => this.#enviarPendentes(token));
    this.#sincronizacoes = execucao.catch(() => {});
    return execucao;
  }

  async #enviarPendentes(token: string): Promise<TentativaEnvio[]> {
    const tentativas: TentativaEnvio[] = [];
    for (const pedido of await this.listar()) {
      if (pedido.estado !== 'aguardando_confirmacao') continue;
      const resultado = await this.#opcoes.enviar(pedido.envio, token);
      tentativas.push({ vendaId: pedido.vendaId, ...resultado });
      if (resultado.estado === 'confirmado') {
        await this.#alterar(async () => {
          const pedidos = await this.#carregar();
          const atual = this.#obter(pedidos, pedido.vendaId);
          if (atual.estado === 'aguardando_confirmacao') {
            await this.#substituir(pedidos, { ...atual, estado: 'confirmado', numero: resultado.numero });
          }
        });
      } else if (resultado.motivo === 'rede' || (resultado.motivo === 'http'
        && ([401, 403, 429].includes(resultado.status) || resultado.status >= 500))) {
        break;
      }
    }
    return tentativas;
  }

  #agora(): string {
    return (this.#opcoes.agora?.() ?? new Date()).toISOString();
  }

  #alterar<T>(operacao: () => Promise<T>): Promise<T> {
    const execucao = this.#alteracoes.then(operacao);
    this.#alteracoes = execucao.catch(() => {});
    return execucao;
  }

  #carregar(): Promise<readonly PedidoLocal[]> {
    return this.#opcoes.armazenamento.carregar(this.#opcoes.vendedorId);
  }

  #salvar(pedidos: readonly PedidoLocal[]): Promise<void> {
    return this.#opcoes.armazenamento.salvar(this.#opcoes.vendedorId, pedidos.map(copiarPedido));
  }

  #obter(pedidos: readonly PedidoLocal[], vendaId: string): PedidoLocal {
    const pedido = pedidos.find((atual) => atual.vendaId === vendaId);
    if (!pedido) throw new Error('Pedido não encontrado no aparelho.');
    return pedido;
  }

  #substituir(pedidos: readonly PedidoLocal[], novo: PedidoLocal): Promise<void> {
    return this.#salvar(pedidos.map((pedido) => pedido.vendaId === novo.vendaId ? novo : pedido));
  }
}
