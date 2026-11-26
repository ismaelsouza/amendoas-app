import * as v from 'valibot';

const id = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4_294_967_295));
const dataIso = v.pipe(v.string(), v.isoTimestamp());
const txt = v.pipe(v.string(), v.minLength(1), v.maxLength(120));
const saldo = v.pipe(v.string(), v.regex(/^\d+(\.\d{3})?$/));
const produto = { apresentacaoId: id, apresentacao: txt, unidade: v.picklist(['pacote', 'caixa', 'kg']) };
const sessaoSchema = v.object({
  token: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{43}$/)),
  usuario: v.object({ id, nome: txt, perfil: v.literal('vendedor') }),
});
const paginaSchema = v.object({
  pedidos: v.array(v.object({ numero: id, cliente: txt, fechadoEm: dataIso })),
  proximoAntesDe: v.nullable(id),
});
const preco = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999_999_999));
const valorItem = { quantidade: saldo, precoUnitarioCentavos: preco };
const correcoesSchema = v.object({
  pedidoNumero: id, podeSolicitar: v.boolean(),
  itens: v.array(v.object({ ...produto, ...valorItem })),
  correcoes: v.array(v.object({
    numero: id, motivo: v.pipe(v.string(), v.minLength(1), v.maxLength(240)),
    solicitadaEm: dataIso, autorizadaEm: v.nullable(dataIso),
    situacao: v.picklist(['pendente', 'aprovada', 'impedida']),
    itens: v.array(v.object({ ...produto, anterior: v.object(valorItem), proposta: v.object(valorItem) })),
  })),
});
const confirmacaoCorrecaoSchema = v.object({ numero: id });
const apresentacoesSchema = {
  apresentacoes: v.array(v.object({
    id, apresentacao: txt, unidade: produto.unidade,
    precoPadraoCentavos: preco, precoNegociadoCentavos: v.nullable(preco),
  })),
};
export const catalogoGeralSchema = v.object(apresentacoesSchema);
export const catalogoSchema = v.object({
  cliente: v.object({ id, nome: txt }), ...apresentacoesSchema,
});
const cnpjNormalizado = v.pipe(v.string(), v.regex(/^[0-9A-Z]{12}[0-9]{2}$/));
export const clientesDeCampoSchema = v.object({
  clientes: v.array(v.object({ id, nome: txt, cnpj: v.nullable(cnpjNormalizado) })),
});
const acompanhamentoSchema = v.object({
  pedidoNumero: id,
  situacao: v.picklist(['aguardando_despacho', 'em_entrega', 'entrega_parcial', 'entregue', 'sem_aceite',
    'finalizado_entrega_parcial', 'cancelado']),
  itens: v.array(v.object({
    ...produto, pedida: saldo, despachada: saldo, recebida: saldo, recusada: saldo, cancelada: saldo,
    emTransito: saldo, pendenteDespacho: saldo, pendenteRecebimento: saldo,
  })),
  remessas: v.array(v.object({
    numero: id, modalidade: v.picklist(['frota_propria', 'transportadora', 'retirada']),
    itens: v.array(v.object({ ...produto, despachada: saldo })),
    recebimento: v.nullable(v.object({
      confirmadoEm: dataIso,
      itens: v.array(v.object({ apresentacaoId: id, recebida: saldo, recusada: saldo })),
    })),
  })),
});
export type Vendedor = v.InferOutput<typeof sessaoSchema>;
export type PaginaVendas = v.InferOutput<typeof paginaSchema>;
export type Acompanhamento = v.InferOutput<typeof acompanhamentoSchema>;
export type CatalogoCliente = v.InferOutput<typeof catalogoSchema>;
export type CatalogoGeral = v.InferOutput<typeof catalogoGeralSchema>;
export type ClienteDeCampo = v.InferOutput<typeof clientesDeCampoSchema>['clientes'][number];
export type NovoClienteCampo = {
  cnpj: string; nome: string; telefone: string;
  endereco: {
    cep: string; logradouro: string; numero: string | null; bairro: string; municipio: string; uf: string; complemento?: string;
  };
};
export type Correcoes = v.InferOutput<typeof correcoesSchema>;
export type PropostaCorrecao = {
  correcaoId: string; motivo: string; itens: (Pick<Correcoes['itens'][number], 'apresentacaoId' | keyof typeof valorItem>)[];
};
type Falha = 'rede' | 'sessao' | 'nao_encontrado' | 'invalido' | 'resposta' | 'servidor' | 'conflito';
type Resultado<T> = { success: true; data: T } | { success: false; error: Falha };
type Buscar = (url: string, opcoes: RequestInit) => Promise<Response>;
type Acoes = {
  entrar(login: string, senha: string): Promise<Resultado<Vendedor>>;
  sair(token: string): Promise<Resultado<null>>;
  listar(token: string, cursor?: number): Promise<Resultado<PaginaVendas>>;
  entregas(token: string, numero: number): Promise<Resultado<Acompanhamento>>;
  correcoes(token: string, numero: number): Promise<Resultado<Correcoes>>;
  solicitarCorrecao(token: string, numero: number, proposta: PropostaCorrecao): Promise<Resultado<{ numero: number }>>;
  consultarCliente(token: string, cnpj: string): Promise<Resultado<CatalogoCliente>>;
  consultarPrecosDoCliente(token: string, clienteId: number): Promise<Resultado<CatalogoCliente>>;
  listarClientes(token: string): Promise<Resultado<{ clientes: ClienteDeCampo[] }>>;
  cadastrarCliente(token: string, dados: NovoClienteCampo): Promise<Resultado<CatalogoCliente>>;
  catalogoGeral(token: string): Promise<Resultado<CatalogoGeral>>;
};

export function criarAcompanhamento(base: string, buscar: Buscar = fetch): Acoes {
  const raiz = base.replace(/\/+$/, '') + '/api/v1';
  async function obter<S extends v.GenericSchema>(
    caminho: string, schema: S, metodo: string, token?: string, body?: string,
  ): Promise<Resultado<v.InferOutput<S>>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), 10_000);
    try {
      const r = await buscar(raiz + caminho, { method: metodo, headers, ...(body !== undefined && { body }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controle.signal });
      if (r.status === 401 || r.status === 403) return { success: false, error: 'sessao' };
      if (r.status === 404) return { success: false, error: 'nao_encontrado' };
      if (r.status === 400 || r.status === 422) return { success: false, error: 'invalido' };
      if (r.status === 409) return { success: false, error: 'conflito' };
      if (!r.ok) return { success: false, error: 'servidor' };
      const dados = v.safeParse(schema, r.status === 204 ? null : await r.json().catch(() => undefined));
      return dados.success ? { success: true, data: dados.output } : { success: false, error: 'resposta' };
    } catch { return { success: false, error: 'rede' }; }
    finally { clearTimeout(limite); }
  }
  return {
    entrar: (login, senha) => obter('/sessao/app', sessaoSchema, 'POST', undefined, JSON.stringify({ login, senha })),
    sair: (token) => obter('/sessao/app', v.null(), 'DELETE', token),
    listar: (token, cursor) => {
      if (cursor !== undefined && !v.is(id, cursor)) return Promise.resolve({ success: false, error: 'resposta' });
      return obter('/pedidos/campo' + (cursor === undefined ? '' : `?antesDe=${cursor}`), paginaSchema, 'GET', token);
    },
    entregas: async (token, numero) => {
      if (!v.is(id, numero)) return { success: false, error: 'resposta' };
      const r = await obter(`/pedidos/campo/${numero}/entregas`, acompanhamentoSchema, 'GET', token);
      return r.success && r.data.pedidoNumero !== numero ? { success: false, error: 'resposta' } : r;
    },
    correcoes: async (token, numero) => {
      if (!v.is(id, numero)) return { success: false, error: 'resposta' };
      const r = await obter(`/pedidos/campo/${numero}/correcoes`, correcoesSchema, 'GET', token);
      return r.success && r.data.pedidoNumero !== numero ? { success: false, error: 'resposta' } : r;
    },
    solicitarCorrecao: (token, numero, proposta) => !v.is(id, numero)
      ? Promise.resolve({ success: false, error: 'resposta' })
      : obter(`/pedidos/campo/${numero}/correcoes`, confirmacaoCorrecaoSchema, 'POST', token, JSON.stringify(proposta)),
    consultarCliente: (token, cnpj) => obter('/cadastros/campo/cliente?' + new URLSearchParams({ cnpj }), catalogoSchema, 'GET', token),
    consultarPrecosDoCliente: async (token, clienteId) => {
      if (!v.is(id, clienteId)) return { success: false, error: 'invalido' };
      const r = await obter(`/cadastros/campo/cliente?id=${clienteId}`, catalogoSchema, 'GET', token);
      return r.success && r.data.cliente.id !== clienteId ? { success: false, error: 'resposta' } : r;
    },
    listarClientes: (token) => obter('/cadastros/campo/clientes', clientesDeCampoSchema, 'GET', token),
    cadastrarCliente: (token, dados) => obter('/cadastros/campo/cliente', catalogoSchema, 'POST', token, JSON.stringify(dados)),
    catalogoGeral: (token) => obter('/cadastros/campo/catalogo', catalogoGeralSchema, 'GET', token),
  };
}
