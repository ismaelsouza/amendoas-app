import * as v from 'valibot';
import { catalogoGeralSchema, catalogoSchema, clientesDeCampoSchema } from './tracking.js';
import type { CatalogoCliente, CatalogoGeral, ClienteDeCampo, Vendedor } from './tracking.js';

const prefixo = 'amendoas-v1:homologacao:';
const chaveAcesso = prefixo + 'acesso-offline';
const chaveClientes = (vendedorId: number) => `${prefixo}clientes:${vendedorId}`;
const perfilSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4_294_967_295)),
  nome: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  perfil: v.literal('vendedor'),
});

function ler<S extends v.GenericSchema>(chave: string, schema: S): v.InferOutput<S> | null {
  try {
    const dado = v.safeParse(schema, JSON.parse(localStorage.getItem(chave) ?? 'null'));
    return dado.success ? dado.output : null;
  } catch { return null; }
}

export function perfilOffline(): Vendedor['usuario'] | null {
  return ler(chaveAcesso, perfilSchema);
}

export function permitirAcessoOffline(perfil: Vendedor['usuario'] | null): void {
  const anterior = perfilOffline();
  if (perfil) localStorage.setItem(chaveAcesso, JSON.stringify(perfil));
  else localStorage.removeItem(chaveAcesso);
  if (anterior && anterior.id !== perfil?.id) localStorage.removeItem(chaveClientes(anterior.id));
}

export function lerClientes(vendedorId: number): ClienteDeCampo[] | null {
  return perfilOffline()?.id === vendedorId ? ler(chaveClientes(vendedorId), clientesDeCampoSchema)?.clientes ?? null : null;
}

export function guardarClientes(vendedorId: number, clientes: ClienteDeCampo[]): void {
  if (perfilOffline()?.id === vendedorId) localStorage.setItem(chaveClientes(vendedorId), JSON.stringify({ clientes }));
}

const cotacaoSchema = v.object({
  atual: catalogoSchema,
  anterior: v.nullable(catalogoSchema),
});
export type CotacaoRascunho = v.InferOutput<typeof cotacaoSchema>;
const chaveCotacao = (vendedorId: number, vendaId: string) => `${prefixo}cotacao:${vendedorId}:${vendaId}`;

export function lerCotacao(vendedorId: number, vendaId: string, clienteId: number): CotacaoRascunho | null {
  const cotacao = ler(chaveCotacao(vendedorId, vendaId), cotacaoSchema);
  return cotacao?.atual.cliente.id === clienteId
    && (!cotacao.anterior || cotacao.anterior.cliente.id === clienteId) ? cotacao : null;
}

export function guardarCotacao(
  vendedorId: number, vendaId: string, atual: CatalogoCliente,
): CotacaoRascunho {
  const existente = lerCotacao(vendedorId, vendaId, atual.cliente.id);
  const cotacao = { atual, anterior: existente?.anterior ?? existente?.atual ?? null };
  localStorage.setItem(chaveCotacao(vendedorId, vendaId), JSON.stringify(cotacao));
  return cotacao;
}

const chaveGeral = (vendedorId: number) => `${prefixo}catalogo-geral:${vendedorId}`;

export function lerCatalogoGeral(vendedorId: number): CatalogoGeral | null {
  return ler(chaveGeral(vendedorId), catalogoGeralSchema);
}

export function guardarCatalogoGeral(vendedorId: number, catalogo: CatalogoGeral): void {
  localStorage.setItem(chaveGeral(vendedorId), JSON.stringify(catalogo));
}
