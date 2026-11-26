import { criarAcompanhamento } from './tracking.js';
import type { Acompanhamento, PaginaVendas, Vendedor } from './tracking.js';
import { iniciarRascunhos } from './field-draft-ui.js';
import { controlesDeCorrecao } from './corrections-ui.js';
import { perfilOffline, permitirAcessoOffline } from './browser-drafts.js';

function porId<T extends HTMLElement>(id: string, tipo: { new(): T }): T {
  const elemento = document.getElementById(id);
  if (!(elemento instanceof tipo)) throw new Error(`Elemento inválido: ${id}`);
  return elemento;
}
const form = porId('entrar', HTMLFormElement);
const login = porId('login', HTMLInputElement);
const senha = porId('senha', HTMLInputElement);
const entrar = porId('botao-entrar', HTMLButtonElement);
const permitirOffline = porId('permitir-offline', HTMLInputElement);
const abrirOffline = porId('abrir-offline', HTMLButtonElement);
const fecharOffline = porId('fechar-offline', HTMLButtonElement);
const painel = porId('painel', HTMLElement);
const rascunhos = porId('painel-rascunhos', HTMLElement);
const nome = porId('vendedor', HTMLElement);
const lista = porId('lista-vendas', HTMLElement);
const mais = porId('mais', HTMLButtonElement);
const atualizar = porId('atualizar', HTMLButtonElement);
const sair = porId('sair', HTMLButtonElement);
const status = porId('status', HTMLElement);
const erro = porId('erro', HTMLElement);
const base = location.origin + '/api-amendoas-adm';
const api = criarAcompanhamento(base);
const instalacaoSegura = location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const avisoAmbiente = document.getElementById('aviso-ambiente');
if (avisoAmbiente instanceof HTMLElement && /(?:^|\.)[^.]*-dsv\./i.test(location.hostname)) {
  avisoAmbiente.textContent = 'Ambiente de desenvolvimento (DSV) — dados de teste';
  avisoAmbiente.hidden = false;
  document.title = `[DSV] ${document.title}`;
}
const hora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });
const situacoes: Record<Acompanhamento['situacao'], string> = {
  aguardando_despacho: 'Aguardando despacho', em_entrega: 'Em entrega', entrega_parcial: 'Entrega parcial',
  entregue: 'Entregue', sem_aceite: 'Recebimento sem aceite',
  finalizado_entrega_parcial: 'Finalizado com entrega parcial', cancelado: 'Cancelado',
};
const modalidades: Record<Acompanhamento['remessas'][number]['modalidade'], string> = {
  frota_propria: 'Frota própria', transportadora: 'Transportadora', retirada: 'Retirada',
};
const erros = {
  rede: 'Não foi possível conectar. Confira a rede e tente novamente.',
  sessao: 'Login inválido ou sessão encerrada. Entre de novo.',
  nao_encontrado: 'Pedido não encontrado.',
  invalido: 'Confira os dados informados.',
  resposta: 'O administrativo retornou dados inesperados.',
  servidor: 'O administrativo não pôde concluir a consulta.',
  conflito: 'O pedido mudou. Atualize a consulta.',
};
type Falha = keyof typeof erros;
let sessao: Vendedor | null = null;
let cursor: number | null = null;
let pararRascunhos: (() => void) | undefined;

function texto<K extends keyof HTMLElementTagNameMap>(tag: K, conteudo: string): HTMLElementTagNameMap[K] {
  const elemento = document.createElement(tag);
  elemento.textContent = conteudo;
  return elemento;
}

function limparSessao() {
  pararRascunhos?.();
  pararRascunhos = undefined;
  rascunhos.hidden = true;
  fecharOffline.hidden = true;
  sessao = null;
  painel.hidden = true;
  form.hidden = false;
  lista.replaceChildren();
  status.textContent = '';
  abrirOffline.hidden = !perfilOffline();
}

function falha(codigo: Falha) {
  if (codigo === 'sessao' && sessao) limparSessao();
  erro.textContent = erros[codigo];
}

function abrirRascunhos(usuario: Vendedor['usuario'], token: string | null) {
  pararRascunhos?.();
  pararRascunhos = undefined;
  rascunhos.hidden = true;
  try {
    pararRascunhos = iniciarRascunhos(rascunhos, api, usuario, token, base, () => falha('sessao'), () => void listar());
    rascunhos.hidden = false;
  } catch {
    erro.textContent = 'Rascunhos indisponíveis neste navegador.';
  }
}

function qtd(valor: string, unidade: string): string { return `${valor.replace('.', ',')} ${unidade}`; }

function renderEntregas(d: Acompanhamento): DocumentFragment {
  const resultado = document.createDocumentFragment();
  resultado.append(texto('h4', situacoes[d.situacao]));
  const itens = document.createElement('ul');
  for (const item of d.itens) {
    const u = item.unidade;
    itens.append(texto('li', `${item.apresentacao}. Pedido: ${qtd(item.pedida, u)}. Despachado: ${qtd(item.despachada, u)}. `
      + `Recebido: ${qtd(item.recebida, u)}. Recusado: ${qtd(item.recusada, u)}.`
      + (Number(item.cancelada) > 0 ? ` Cancelado: ${qtd(item.cancelada, u)}.` : '')
      + ` A receber: ${qtd(item.pendenteRecebimento, u)}.`));
  }
  resultado.append(itens);
  for (const remessa of d.remessas) {
    const bloco = document.createElement('section');
    const registro = remessa.recebimento;
    bloco.append(texto('strong', `Remessa nº ${remessa.numero} · ${modalidades[remessa.modalidade]}`));
    bloco.append(texto('p', registro ? `Recebimento confirmado em ${hora.format(new Date(registro.confirmadoEm))}` : 'Recebimento ainda não confirmado.'));
    const linhas = document.createElement('ul');
    for (const item of remessa.itens) {
      const rec = registro?.itens.find(({ apresentacaoId }) => apresentacaoId === item.apresentacaoId);
      linhas.append(texto('li', `${item.apresentacao}: ${qtd(item.despachada, item.unidade)} despachado(s)`
        + (rec ? `, ${qtd(rec.recebida, item.unidade)} recebido(s), ${qtd(rec.recusada, item.unidade)} recusado(s).` : '.')));
    }
    bloco.append(linhas);
    resultado.append(bloco);
  }
  return resultado;
}

function vendaCard(pedido: PaginaVendas['pedidos'][number]) {
  const card = document.createElement('article');
  const btn = texto('button', 'Ver entregas');
  btn.type = 'button';
  const detalhes = document.createElement('div');
  detalhes.setAttribute('aria-live', 'polite');
  btn.addEventListener('click', async () => {
    const atual = sessao;
    if (!atual || btn.disabled) return;
    btn.disabled = true;
    detalhes.textContent = 'Consultando entregas…';
    erro.textContent = '';
    const r = await api.entregas(atual.token, pedido.numero);
    if (atual !== sessao || !card.isConnected) return;
    btn.disabled = false;
    btn.textContent = 'Atualizar entregas';
    detalhes.replaceChildren();
    if (r.success) detalhes.append(renderEntregas(r.data));
    else falha(r.error);
  });
  card.append(texto('h3', `Pedido nº ${pedido.numero} · ${pedido.cliente}`), texto('p', hora.format(new Date(pedido.fechadoEm))),
    btn, detalhes, controlesDeCorrecao({
      api, numero: pedido.numero, sessaoAtual: () => sessao?.token ?? null, semSessao: () => falha('sessao'),
    }));
  return card;
}

async function listar(continuar = false) {
  const atual = sessao;
  if (!atual || (continuar && cursor === null)) return;
  erro.textContent = '';
  mais.disabled = atualizar.disabled = true;
  status.textContent = 'Consultando pedidos…';
  const r = await api.listar(atual.token, continuar ? cursor ?? undefined : undefined);
  if (atual !== sessao) return;
  mais.disabled = atualizar.disabled = false;
  status.textContent = '';
  if (!r.success) { falha(r.error); return; }
  cursor = r.data.proximoAntesDe;
  if (!continuar) lista.replaceChildren();
  lista.append(...r.data.pedidos.map(vendaCard));
  if (!continuar && !r.data.pedidos.length) status.textContent = 'Nenhum pedido confirmado para este vendedor.';
  mais.hidden = cursor === null;
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!instalacaoSegura || entrar.disabled) return;
  entrar.disabled = true;
  erro.textContent = '';
  const r = await api.entrar(login.value.trim(), senha.value);
  senha.value = '';
  entrar.disabled = false;
  if (!r.success) { falha(r.error); return; }
  sessao = r.data;
  nome.textContent = r.data.usuario.nome;
  form.hidden = true;
  painel.hidden = false;
  fecharOffline.hidden = true;
  abrirOffline.hidden = true;
  try {
    permitirAcessoOffline(permitirOffline.checked ? r.data.usuario : null);
  } catch {
    erro.textContent = 'O navegador não conseguiu salvar a preferência de acesso offline.';
  }
  abrirRascunhos(r.data.usuario, r.data.token);
  void listar();
});
abrirOffline.addEventListener('click', () => {
  const perfil = perfilOffline();
  if (!perfil || sessao) return;
  abrirRascunhos(perfil, null);
  abrirOffline.hidden = true;
  fecharOffline.hidden = false;
});
fecharOffline.addEventListener('click', limparSessao);
mais.addEventListener('click', () => void listar(true));
atualizar.addEventListener('click', () => void listar());
sair.addEventListener('click', () => {
  const antes = sessao;
  erro.textContent = '';
  try { permitirAcessoOffline(null); }
  catch { erro.textContent = 'Não foi possível desativar o acesso offline. Limpe os dados deste site no navegador.'; }
  permitirOffline.checked = false;
  limparSessao();
  if (antes) void api.sair(antes.token);
});
if (!instalacaoSegura) {
  entrar.disabled = true;
  erro.textContent = 'Abra o aplicativo por HTTPS antes de informar sua senha.';
} else {
  abrirOffline.hidden = !perfilOffline();
  if (!document.documentElement.hasAttribute('data-android-embarcado') && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      porId('aviso-offline', HTMLElement).textContent = 'O navegador não preparou a abertura sem internet.';
    });
  }
}
