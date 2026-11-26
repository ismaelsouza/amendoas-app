import { armazenamentoNoAparelho, criarDemonstracao, sincronizarAoRetomar } from './mobile.js';
import { criarEnvioPedidos, PedidosOffline } from './order-sync.js';
import type { DadosRascunho, PedidoLocal, RascunhoLocal } from './order-sync.js';
import { conferirRascunho } from './sale-draft.js';
import type { Precos, Unidade } from './sale-draft.js';

function $(id: string): HTMLElement {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`Elemento ausente: ${id}`);
  return elemento;
}
function campo<T extends HTMLElement>(id: string, tipo: { new(): T }): T {
  const elemento = $(id);
  if (!(elemento instanceof tipo)) throw new Error(`Campo inválido: ${id}`);
  return elemento;
}
const modoOffline = campo('offline', HTMLInputElement);
const perder = campo('perder', HTMLInputElement);
const estado = $('estado');
const aviso = $('aviso');
const erro = $('erro');
const form = campo('rascunho', HTMLFormElement);
const cliente = campo('cliente', HTMLSelectElement);
const nome = campo('nome-avulso', HTMLInputElement);
const opcoes = $('apresentacoes');
const lista = $('pedidos');
const total = $('total');
const enviar = campo('enviar', HTMLButtonElement);
const novo = campo('novo', HTMLButtonElement);
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const sessao = { vendedorId: 1, token: 'demonstracao' };
const clientes = new Map([[1, 'Supermercado Ipê'], [2, 'Mercado Jatobá']]);
const catalogo: { id: number; nome: string; unidade: Unidade }[] = [
  { id: 1, nome: 'Castanha de caju · 250 g', unidade: 'pacote' },
  { id: 2, nome: 'Castanha a granel', unidade: 'kg' },
];
const precos: Precos = { padrao: { 1: 1875, 2: 2988 }, cliente: {} };
const online = () => !modoOffline.checked && navigator.onLine;
modoOffline.checked = localStorage.getItem('amendoas-v1:simular-offline') === 'true';
const pedidos = new PedidosOffline({
  vendedorId: sessao.vendedorId,
  armazenamento: armazenamentoNoAparelho(localStorage, 'demonstracao'),
  gerarId: () => crypto.randomUUID(),
  enviar: criarEnvioPedidos('https://demo.example', criarDemonstracao(localStorage, {
    online,
    perderResposta: () => {
      const perderAgora = perder.checked;
      perder.checked = false;
      return perderAgora;
    },
  })),
});

let editando: string | null = null;
let envioEmCurso = false;
let gravacoes = 0;
let salvamentoFalhou = false;
const campos = new Map<number, HTMLInputElement>();
for (const [id, texto] of clientes) cliente.add(new Option(texto, String(id)));
cliente.add(new Option('Cliente não cadastrado', 'avulso'));
for (const item of catalogo) {
  const label = document.createElement('label');
  label.textContent = `${item.nome} (${item.unidade})`;
  const qtd = document.createElement('input');
  qtd.inputMode = item.unidade === 'kg' ? 'decimal' : 'numeric';
  qtd.maxLength = 10;
  qtd.placeholder = '0';
  label.append(qtd);
  const preco = document.createElement('small');
  const cents = precos.padrao[item.id];
  preco.textContent = cents === undefined ? 'Preço indisponível' : `${moeda.format(cents / 100)} / ${item.unidade}`;
  label.append(preco);
  opcoes.append(label);
  campos.set(item.id, qtd);
}

function dados(): DadosRascunho {
  const id = Number(cliente.value);
  return {
    cliente: { id: clientes.has(id) ? id : null, nome: clientes.get(id) ?? nome.value.trim() },
    itens: catalogo.flatMap(({ id: apresentacaoId, unidade }) => {
      const quantidade = campos.get(apresentacaoId)?.value.trim() ?? '';
      return quantidade === '' ? [] : [{ apresentacaoId, unidade, quantidade }];
    }),
  };
}

function conferir() {
  const atuais = dados();
  const rotulo = nome.parentElement;
  if (rotulo) rotulo.hidden = cliente.value !== 'avulso';
  const { totalCentavos } = conferirRascunho(atuais.itens, precos);
  total.textContent = totalCentavos === null ? 'Confira as quantidades' : moeda.format(totalCentavos / 100);
  enviar.disabled = envioEmCurso || gravacoes > 0 || salvamentoFalhou || atuais.cliente.id === null || totalCentavos === null;
}

function abrir(pedido: RascunhoLocal) {
  editando = pedido.vendaId;
  cliente.value = pedido.cliente.id !== null ? String(pedido.cliente.id) : pedido.cliente.nome ? 'avulso' : '';
  nome.value = pedido.cliente.id === null ? pedido.cliente.nome : '';
  for (const [id, campo] of campos) campo.value = pedido.itens.find((item) => item.apresentacaoId === id)?.quantidade ?? '';
  salvamentoFalhou = false;
  form.hidden = false;
  conferir();
  cliente.focus();
}

function fechar() {
  editando = null;
  form.hidden = true;
}

function mostrarPedido(pedido: PedidoLocal) {
  const card = document.createElement('article');
  const resumo = document.createElement('h3');
  resumo.textContent = (pedido.estado === 'rascunho' ? pedido.cliente.nome : pedido.clienteNome) || 'Cliente não informado';
  const linha = document.createElement('p');
  linha.textContent = pedido.estado === 'rascunho' ? `Rascunho · ${dataHora.format(new Date(pedido.atualizadoEm))}`
    : pedido.estado === 'confirmado' ? `Confirmado · Pedido nº ${pedido.numero}` : 'Aguardando confirmação';
  card.append(resumo, linha);
  const itens = document.createElement('ul');
  for (const item of pedido.estado === 'rascunho' ? pedido.itens : pedido.envio.itens) {
    const produto = catalogo.find(({ id }) => id === item.apresentacaoId);
    const li = document.createElement('li');
    li.textContent = `${produto?.nome ?? 'Produto'}: ${item.quantidade} ${produto?.unidade ?? ''}`
      + ('precoUnitarioCentavos' in item ? ` · ${moeda.format(Number(item.precoUnitarioCentavos) / 100)} por ${produto?.unidade ?? 'unidade'}` : '');
    itens.append(li);
  }
  card.append(itens);
  if (pedido.estado === 'rascunho') {
    const botao = document.createElement('button');
    botao.textContent = 'Abrir rascunho';
    botao.type = 'button';
    botao.addEventListener('click', () => abrir(pedido));
    card.append(botao);
  }
  return card;
}

async function atualizarLista() {
  const locais = await pedidos.listar();
  lista.replaceChildren(...locais.reverse().map(mostrarPedido));
  if (!locais.length) lista.textContent = 'Nenhum pedido no aparelho.';
}

function mostrarErro(falha: unknown) {
  erro.textContent = falha instanceof Error ? falha.message : 'Não foi possível atualizar os pedidos.';
}

async function sincronizar() {
  estado.textContent = online() ? 'Conectado · demonstração' : 'Offline · pedidos salvos no aparelho';
  try {
    const tentativas = await pedidos.sincronizar(sessao);
    const confirmados = tentativas.filter((r) => r.estado === 'confirmado');
    if (confirmados.length) aviso.textContent = `${confirmados.length} pedido(s) confirmado(s).`;
    else if (tentativas.length) aviso.textContent = 'Pedido salvo. Aguardando confirmação.';
    await atualizarLista();
  } catch (falha) { mostrarErro(falha); }
}

form.addEventListener('input', async () => {
  if (!editando || envioEmCurso) return;
  const id = editando;
  erro.textContent = '';
  gravacoes++;
  conferir();
  try {
    await pedidos.salvarRascunho(id, dados());
    if (editando === id) salvamentoFalhou = false;
    await atualizarLista();
  } catch (falha) {
    if (editando === id) salvamentoFalhou = true;
    mostrarErro(falha);
  } finally {
    gravacoes--;
    conferir();
  }
});

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!editando || enviar.disabled) return;
  erro.textContent = '';
  aviso.textContent = '';
  envioEmCurso = true;
  conferir();
  try {
    await pedidos.prepararEnvio(editando, precos);
    fechar();
    await atualizarLista();
    await sincronizar();
  } catch (falha) { mostrarErro(falha); }
  finally { envioEmCurso = false; conferir(); }
});

novo.addEventListener('click', async () => {
  novo.disabled = true;
  erro.textContent = '';
  try {
    abrir(await pedidos.criarRascunho({ cliente: { id: null, nome: '' }, itens: [] }));
    await atualizarLista();
  } catch (falha) { mostrarErro(falha); }
  finally { novo.disabled = false; }
});
$('fechar').addEventListener('click', fechar);
$('sincronizar').addEventListener('click', () => void sincronizar());
modoOffline.addEventListener('change', () => {
  try { localStorage.setItem('amendoas-v1:simular-offline', String(modoOffline.checked)); }
  catch (falha) { mostrarErro(falha); }
  void sincronizar();
});
window.addEventListener('offline', () => { estado.textContent = 'Offline · pedidos salvos no aparelho'; });
sincronizarAoRetomar(window, sincronizar);
