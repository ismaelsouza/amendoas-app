import { armazenamentoNoAparelho, sincronizarAoRetomar } from './mobile.js';
import { criarEnvioPedidos, PedidosOffline } from './order-sync.js';
import type { DadosRascunho, RascunhoLocal } from './order-sync.js';
import { guardarCatalogoGeral, guardarClientes, guardarCotacao, lerCatalogoGeral, lerClientes, lerCotacao } from './browser-drafts.js';
import type { ItemRascunho, Precos } from './sale-draft.js';
import { compararPrecosDoRascunho, conferirRascunho } from './sale-draft.js';
import type { CatalogoCliente, ClienteDeCampo, Vendedor, criarAcompanhamento } from './tracking.js';
import { formularioNovoCliente } from './field-customer-ui.js';
import { montarBuscaCliente } from './field-client-search-ui.js';

type Simplificada = Pick<ReturnType<typeof criarAcompanhamento>,
  'consultarCliente' | 'consultarPrecosDoCliente' | 'listarClientes' | 'catalogoGeral' | 'cadastrarCliente'>;
type CatalogoRascunho = Omit<CatalogoCliente, 'cliente'> & Pick<DadosRascunho, 'cliente'>;
type ClienteVinculado = CatalogoCliente['cliente'];
const avisoSemPrecos = 'Conecte-se e consulte os preços deste cliente antes de enviar.';

function precosDo(catalogo: CatalogoRascunho): Precos {
  if (catalogo.cliente.id === null) return { padrao: {}, cliente: {} };
  return {
    padrao: Object.fromEntries(catalogo.apresentacoes.map((a) => [a.id, a.precoPadraoCentavos])),
    cliente: Object.fromEntries(catalogo.apresentacoes.flatMap((a) => a.precoNegociadoCentavos === null ? [] : [[a.id, a.precoNegociadoCentavos]])),
  };
}

export function iniciarRascunhos(
  caixa: HTMLElement, api: Simplificada, usuario: Vendedor['usuario'], token: string | null, base: string,
  semSessao: () => void, aoConfirmar: () => void,
): () => void {
  const encerrar = new AbortController();
  const locais = new PedidosOffline({
    vendedorId: usuario.id, armazenamento: armazenamentoNoAparelho(localStorage, 'homologacao'),
    gerarId: () => crypto.randomUUID(), enviar: criarEnvioPedidos(base, fetch, encerrar.signal),
  });
  let ativo = true;
  let sincronizando = false;
  let repetir = false;
  let navegacao = 0;
  let editandoId = '';
  let geral = lerCatalogoGeral(usuario.id);
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const datas = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });
  const estado = document.createElement('p');
  estado.className = 'mensagem';
  estado.setAttribute('role', 'status');
  const area = document.createElement('div');
  area.className = 'editor-rascunho';
  const novo = document.createElement('button');
  novo.type = 'button';
  novo.className = 'secundario';
  novo.textContent = 'Novo rascunho sem cadastro';
  novo.hidden = !geral?.apresentacoes.length;
  const statusFila = document.createElement('p');
  statusFila.className = 'mensagem';
  statusFila.setAttribute('role', 'status');
  const fila = document.createElement('div');
  const tentar = document.createElement('button');
  tentar.type = 'button';
  tentar.textContent = 'Tentar sincronizar';
  tentar.hidden = true;
  const consulta = document.createElement('form');
  consulta.className = 'consulta-cnpj';
  const label = document.createElement('label');
  label.textContent = 'CNPJ';
  const cnpj = document.createElement('input');
  cnpj.autocomplete = 'off';
  cnpj.autocapitalize = 'characters';
  cnpj.maxLength = 18;
  cnpj.required = true;
  label.append(cnpj);
  const buscar = document.createElement('button');
  buscar.textContent = 'Consultar CNPJ';
  consulta.hidden = !token;
  const titulo = document.createElement('h2');
  titulo.id = 'titulo-rascunhos';
  titulo.textContent = 'Rascunhos de venda';
  const explicacao = document.createElement('p');
  explicacao.textContent = token
    ? 'Busque um cliente para abrir uma venda ou retome um pedido salvo neste aparelho.'
    : `Pedidos de ${usuario.nome} neste aparelho. Entre com a mesma conta para sincronizar e consultar entregas.`;
  const buscaClientes = montarBuscaCliente((cliente) => void selecionarCliente(cliente));
  const clientesSalvos = lerClientes(usuario.id);
  if (clientesSalvos) buscaClientes.atualizar(clientesSalvos);
  buscaClientes.elemento.hidden = !token && !clientesSalvos;
  consulta.append(label, buscar);
  caixa.replaceChildren(titulo, explicacao, buscaClientes.elemento, consulta, novo, estado, area, statusFila, fila, tentar);

  function erroLocal() {
    if (ativo) estado.textContent = 'Não foi possível abrir ou salvar o rascunho no navegador.';
  }

  async function abrirRascunho(vendaId: string) {
    const tentativa = ++navegacao;
    const atualizando = () => ativo && tentativa === navegacao;
    try {
      const atual = (await locais.listar()).find((item) => item.vendaId === vendaId);
      if (!atualizando() || atual?.estado !== 'rascunho') return;
      estado.textContent = '';
      const cliente = atual.cliente;
      if (cliente.id === null) {
        if (geral) editar(atual.vendaId, { ...geral, cliente }, atual.itens);
        return;
      }
      let cotacao = lerCotacao(usuario.id, atual.vendaId, cliente.id);
      let bloqueado = false;
      if (token && navigator.onLine) {
        area.replaceChildren();
        estado.textContent = 'Conferindo os preços do rascunho…';
        const r = await api.consultarPrecosDoCliente(token, cliente.id);
        if (!atualizando()) return;
        if (!r.success && r.error === 'sessao') { semSessao(); return; }
        if (r.success) cotacao = guardarCotacao(usuario.id, atual.vendaId, r.data);
        else bloqueado = r.error !== 'rede';
        estado.textContent = bloqueado ? 'Não foi possível confirmar o cadastro e os preços. Confira o cliente antes de enviar.' : '';
      }
      if (cotacao) editar(atual.vendaId, cotacao.atual, atual.itens, { anterior: cotacao.anterior, bloqueado });
      else editarSemCotacao(atual);
    } catch { erroLocal(); }
  }

  async function mostrarFila() {
    const pedidos = await locais.listar();
    if (!ativo) return;
    tentar.hidden = !token || !pedidos.some((p) => p.estado === 'aguardando_confirmacao');
    fila.replaceChildren(...pedidos.sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm)).map((p) => {
      const card = document.createElement('article');
      const nome = document.createElement('h4');
      if (p.estado === 'rascunho') {
        card.className = 'pedido-local';
        nome.textContent = p.cliente.nome || 'Cliente não informado';
        const data = document.createElement('p');
        data.textContent = `Rascunho · ${datas.format(new Date(p.atualizadoEm))}`;
        const abrir = document.createElement('button');
        abrir.type = 'button';
        abrir.className = 'secundario';
        abrir.textContent = 'Abrir rascunho';
        abrir.addEventListener('click', () => void abrirRascunho(p.vendaId));
        card.append(nome, data, abrir);
        return card;
      }
      nome.textContent = p.clienteNome;
      card.className = p.estado === 'aguardando_confirmacao' ? 'pedido-local aguardando' : 'pedido-local';
      const situacao = document.createElement('p');
      situacao.textContent = p.estado === 'confirmado' ? `Pedido nº ${p.numero}` : 'Aguardando confirmação';
      const itens = document.createElement('ul');
      const catalogo = lerCotacao(usuario.id, p.vendaId, p.envio.clienteId)?.atual ?? geral;
      for (const item of p.envio.itens) {
        const linha = document.createElement('li');
        const produto = catalogo?.apresentacoes.find(({ id }) => item.apresentacaoId === id);
        linha.textContent = `${produto?.apresentacao ?? `Apresentação ${item.apresentacaoId}`}: `
          + `${item.quantidade.replace('.', ',')} × ${moeda.format(item.precoUnitarioCentavos / 100)}`;
        itens.append(linha);
      }
      card.append(nome, situacao);
      if (p.estado === 'confirmado') {
        const origem = document.createElement('small');
        origem.textContent = 'Itens do envio original. Consulte os dados vigentes no acompanhamento.';
        card.append(origem);
      }
      card.append(itens);
      return card;
    }));
  }

  async function sincronizar() {
    if (sincronizando || !ativo) return;
    sincronizando = tentar.disabled = true;
    try {
      do {
        repetir = false;
        await mostrarFila();
        if (!ativo || !token || !navigator.onLine) return;
        const resultados = await locais.sincronizar({ vendedorId: usuario.id, token });
        if (!ativo) return;
        const numeros = resultados.flatMap((r) => r.estado === 'confirmado' ? [r.numero] : []);
        const expirou = resultados.some((r) => r.estado === 'pendente' && r.motivo === 'http' && [401, 403].includes(r.status));
        if (expirou) { semSessao(); return; }
        const falhou = resultados.some((r) => r.estado === 'pendente');
        if (falhou) statusFila.textContent = 'Sem resposta do administrativo ou pedido não confirmado. O envio continua salvo no aparelho.';
        else if (numeros.length) statusFila.textContent = `Confirmação recuperada: pedido nº ${numeros.join(', ')}.`;
        await mostrarFila();
        if (numeros.length) aoConfirmar();
      } while (ativo && repetir);
    } catch { erroLocal(); }
    finally { sincronizando = tentar.disabled = false; }
  }

  function editar(
    identificador: string, catalogo: CatalogoRascunho, itensSalvos: readonly ItemRascunho[],
    { anterior = null, bloqueado = false, precosPendentes = false }: {
      anterior?: CatalogoCliente | null; bloqueado?: boolean; precosPendentes?: boolean;
    } = {},
  ) {
    editandoId = identificador;
    const vinculado = catalogo.cliente.id !== null;
    const precos = precosPendentes ? { padrao: {}, cliente: {} } : precosDo(catalogo);
    const precosAnteriores = anterior && precosDo(anterior);
    const conhecidos = new Set(catalogo.apresentacoes.map((a) => a.id));
    const outros = itensSalvos.filter((item) => !conhecidos.has(item.apresentacaoId));
    const controles = new Map<number, { campo: HTMLInputElement; subtotal: HTMLElement; mudanca: HTMLElement }>();
    const produtos = document.createElement('fieldset');
    produtos.className = 'itens-rascunho';
    const titulo = document.createElement('legend');
    titulo.textContent = vinculado ? `Rascunho de ${catalogo.cliente.nome}` : 'Rascunho sem cadastro';
    produtos.append(titulo);
    const nomeCliente = document.createElement('input');
    if (!vinculado) {
      const rotulo = document.createElement('label');
      rotulo.textContent = 'Nome do supermercado';
      nomeCliente.maxLength = 120;
      nomeCliente.value = catalogo.cliente.nome;
      rotulo.append(nomeCliente);
      produtos.append(rotulo);
    }
    const total = document.createElement('p');
    total.className = 'total-rascunho';
    const gravacao = document.createElement('p');
    gravacao.setAttribute('role', 'status');
    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.textContent = 'Enviar pedido';
    const revisar = document.createElement('label');
    revisar.className = 'opcao';
    const revisado = document.createElement('input');
    revisado.type = 'checkbox';
    revisar.append(revisado, 'Conferi os novos preços com o cliente');
    const formatar = (centavos: number | null) => centavos === null ? 'indisponível' : moeda.format(centavos / 100);
    let gravacoes = 0;
    let fechando = false;
    let falhou = false;
    for (const a of catalogo.apresentacoes) {
      const rotulo = document.createElement('label');
      rotulo.textContent = `${a.apresentacao} (${a.unidade})`;
      const quantidade = document.createElement('input');
      quantidade.inputMode = a.unidade === 'kg' ? 'decimal' : 'numeric';
      quantidade.maxLength = 10;
      quantidade.placeholder = '0';
      quantidade.value = itensSalvos.find((item) => item.apresentacaoId === a.id)?.quantidade ?? '';
      rotulo.append(quantidade);
      const preco = document.createElement('small');
      const tipo = a.precoNegociadoCentavos === null ? 'padrão' : 'negociado';
      preco.textContent = `${moeda.format((a.precoNegociadoCentavos ?? a.precoPadraoCentavos) / 100)} por ${a.unidade} · preço ${tipo}`;
      if (vinculado && !precosPendentes) rotulo.append(preco);
      const subtotal = document.createElement('small');
      const mudanca = document.createElement('small');
      mudanca.className = 'mudanca-preco';
      rotulo.append(subtotal, mudanca);
      produtos.append(rotulo);
      controles.set(a.id, { campo: quantidade, subtotal, mudanca });
    }
    function conferir(): ItemRascunho[] {
      const itens = [...outros, ...catalogo.apresentacoes.flatMap(({ id, unidade }) => {
        const quantidade = controles.get(id)?.campo.value.trim();
        return quantidade ? [{ apresentacaoId: id, unidade, quantidade }] : [];
      })];
      const resultado = conferirRascunho(itens, precos);
      const alteracoes = precosAnteriores ? compararPrecosDoRascunho(itens, precosAnteriores, precos) : [];
      for (const [id, { subtotal, mudanca }] of controles) {
        const item = resultado.itens.find((linha) => linha.apresentacaoId === id);
        subtotal.textContent = !item || !vinculado || precosPendentes ? '' : item.subtotalCentavos === null
          ? 'Confira a quantidade e o preço.' : `Subtotal: ${moeda.format(item.subtotalCentavos / 100)}`;
        const alteracao = alteracoes.find((linha) => linha.apresentacaoId === id);
        mudanca.hidden = !alteracao || !item;
        if (alteracao && item) {
          const linha = (texto: string, valor: typeof alteracao.atual) => {
            const p = document.createElement('span');
            p.textContent = `${texto}: ${formatar(valor.precoUnitarioCentavos)} por ${item.unidade} · subtotal ${formatar(valor.subtotalCentavos)}`;
            return p;
          };
          mudanca.replaceChildren(linha('Antes', alteracao.anterior), linha('Agora', alteracao.atual));
        }
      }
      revisar.hidden = !alteracoes.length;
      total.textContent = !vinculado ? 'Selecione o cliente para conferir os preços e enviar.'
        : precosPendentes ? avisoSemPrecos
        : resultado.totalCentavos === null ? 'Total ainda indisponível.' : `Total: ${moeda.format(resultado.totalCentavos / 100)}`;
      enviar.disabled = !vinculado || bloqueado || resultado.totalCentavos === null || itens.length > 100
        || gravacoes > 0 || fechando || falhou || (alteracoes.length > 0 && !revisado.checked);
      return itens;
    }
    conferir();
    produtos.addEventListener('input', async () => {
      if (!ativo || fechando) return;
      gravacoes++;
      revisado.checked = false;
      gravacao.textContent = '';
      try {
        const cliente = vinculado ? catalogo.cliente : { id: null, nome: nomeCliente.value.trim() };
        await locais.salvarRascunho(identificador, { cliente, itens: conferir() });
        falhou = false;
        if (ativo) gravacao.textContent = 'Rascunho salvo no aparelho.';
        await mostrarFila();
      } catch { falhou = true; erroLocal(); }
      finally { gravacoes--; conferir(); }
    });
    revisado.addEventListener('change', conferir);
    enviar.addEventListener('click', async () => {
      if (!ativo || enviar.disabled) return;
      fechando = produtos.disabled = buscar.disabled = true;
      conferir();
      try {
        await locais.prepararEnvio(identificador, precos);
        if (!ativo) return;
        if (editandoId === identificador) editandoId = '';
        area.replaceChildren();
        statusFila.textContent = 'Pedido salvo no aparelho para envio.';
        await agendarSincronizacao();
      } catch { erroLocal(); }
      finally { fechando = produtos.disabled = buscar.disabled = false; conferir(); }
    });
    area.replaceChildren(produtos, total, revisar, gravacao, enviar);
    if (token && precosPendentes) {
      const consultar = document.createElement('button');
      consultar.type = 'button';
      consultar.className = 'secundario';
      consultar.textContent = 'Consultar preços';
      consultar.addEventListener('click', () => void abrirRascunho(identificador));
      enviar.before(consultar);
    }
  }

  function editarSemCotacao(rascunho: RascunhoLocal) {
    editar(rascunho.vendaId, { cliente: rascunho.cliente, apresentacoes: geral?.apresentacoes ?? [] }, rascunho.itens,
      { precosPendentes: true });
  }
  async function rascunhosCompativeis(clienteId: number | null): Promise<RascunhoLocal[]> {
    return (await locais.listar()).filter((p) => p.estado === 'rascunho')
      .filter((p) => p.cliente.id === null || p.cliente.id === clienteId);
  }

  function escolherRascunho(rascunhos: RascunhoLocal[], selecionado = '') {
    const rotulo = document.createElement('label');
    rotulo.textContent = 'Rascunho que vai receber o cadastro';
    const alvo = document.createElement('select');
    alvo.add(new Option('Novo rascunho', ''));
    for (const p of rascunhos) alvo.add(new Option(`${p.cliente.nome || 'Sem vínculo'} · ${datas.format(new Date(p.atualizadoEm))}`, p.vendaId));
    if (rascunhos.some((r) => r.vendaId === selecionado)) alvo.value = selecionado;
    rotulo.append(alvo);
    return { rotulo, alvo };
  }

  async function vincularRascunho(cliente: ClienteVinculado, catalogo: CatalogoCliente | null, alvo: string, tentativa: number) {
    const existente = alvo ? (await rascunhosCompativeis(cliente.id)).find((p) => p.vendaId === alvo) : undefined;
    if (!ativo || tentativa !== navegacao) return;
    if (alvo && !existente) throw new Error('O rascunho não está mais disponível para vincular.');
    const dados = { cliente, itens: existente?.itens ?? [] };
    const rascunho = existente ? await locais.salvarRascunho(existente.vendaId, dados) : await locais.criarRascunho(dados);
    if (ativo && tentativa === navegacao) {
      const cotacao = catalogo ? guardarCotacao(usuario.id, rascunho.vendaId, catalogo)
        : lerCotacao(usuario.id, rascunho.vendaId, cliente.id);
      if (cotacao) editar(rascunho.vendaId, cotacao.atual, rascunho.itens, { anterior: cotacao.anterior });
      else editarSemCotacao(rascunho);
    }
    await mostrarFila();
  }

  function oferecerVinculo(cliente: ClienteVinculado, catalogo: CatalogoCliente | null, rascunhos: RascunhoLocal[], selecionado = '') {
    editandoId = '';
    const escolha = escolherRascunho(rascunhos, selecionado);
    const vincular = document.createElement('button');
    vincular.textContent = 'Vincular cliente e editar';
    vincular.type = 'button';
    vincular.addEventListener('click', async () => {
      const tentativa = ++navegacao;
      vincular.disabled = buscar.disabled = true;
      try { await vincularRascunho(cliente, catalogo, escolha.alvo.value, tentativa); }
      catch { erroLocal(); }
      finally { vincular.disabled = buscar.disabled = false; }
    });
    area.replaceChildren(escolha.rotulo, vincular);
  }

  async function selecionarCliente(cliente: ClienteDeCampo) {
    if (!ativo || buscar.disabled) return;
    const tentativa = ++navegacao;
    const alvo = editandoId;
    const conferindo = () => ativo && tentativa === navegacao;
    buscar.disabled = true;
    try {
      let catalogo: CatalogoCliente | null = null;
      if (token && navigator.onLine) {
        estado.textContent = 'Conferindo o cadastro e os preços…';
        const r = await api.consultarPrecosDoCliente(token, cliente.id);
        if (!conferindo()) return;
        if (r.success) catalogo = r.data;
        else if (r.error === 'sessao') { semSessao(); return; }
        else if (r.error !== 'rede') {
          estado.textContent = 'Não foi possível confirmar este cadastro. Atualize a lista ou consulte o CNPJ completo.';
          return;
        }
      }
      const rascunhos = await rascunhosCompativeis(cliente.id);
      if (!conferindo()) return;
      const cadastro = catalogo?.cliente ?? { id: cliente.id, nome: cliente.nome };
      estado.textContent = `Cadastro encontrado: ${cadastro.nome}.`;
      if (!rascunhos.length || rascunhos.some((p) => p.vendaId === alvo)) {
        await vincularRascunho(cadastro, catalogo, rascunhos.length ? alvo : '', tentativa);
      } else oferecerVinculo(cadastro, catalogo, rascunhos);
    } catch { erroLocal(); }
    finally { buscar.disabled = false; }
  }

  function oferecerCadastro(documento: string, rascunhos: RascunhoLocal[], tentativa: number, tokenAtual: string) {
    const formulario = formularioNovoCliente({
      cnpj: documento, escolha: escolherRascunho(rascunhos),
      sugerirNome: (id) => rascunhos.find((p) => p.vendaId === id)?.cliente.nome ?? '',
      async cadastrar(dados, vendaId) {
        if (!ativo || tentativa !== navegacao || buscar.disabled) return;
        buscar.disabled = true;
        try {
          const r = await api.cadastrarCliente(tokenAtual, dados);
          if (!ativo || tentativa !== navegacao) return;
          if (r.success) {
            estado.textContent = 'Supermercado cadastrado. Confira as quantidades e os preços antes de enviar.';
            void atualizarClientes();
            try { await vincularRascunho(r.data.cliente, r.data, vendaId, tentativa); }
            catch { return 'O cadastro foi salvo, mas o rascunho não pôde ser vinculado. Consulte o mesmo CNPJ para retomá-lo.'; }
            return;
          }
          if (r.error === 'sessao') { semSessao(); return; }
          if (r.error === 'conflito') {
            const existente = await api.consultarCliente(tokenAtual, documento);
            if (!ativo || tentativa !== navegacao) return;
            if (!existente.success) {
              if (existente.error === 'sessao') semSessao();
              else return 'O CNPJ já está cadastrado. Consulte o mesmo CNPJ para usar o cadastro existente.';
              return;
            }
            const compativeis = await rascunhosCompativeis(existente.data.cliente.id);
            if (!ativo || tentativa !== navegacao) return;
            estado.textContent = `CNPJ já cadastrado: ${existente.data.cliente.nome}. Confira o vínculo com o rascunho.`;
            oferecerVinculo(existente.data.cliente, existente.data, compativeis, vendaId);
            return;
          }
          return r.error === 'invalido' ? 'Confira o nome, o endereço e o telefone com DDD.'
            : 'Não foi possível confirmar o cadastro. Tente de novo ou consulte o mesmo CNPJ.';
        } catch { return 'Não foi possível concluir o vínculo. Consulte o mesmo CNPJ para continuar.'; }
        finally { buscar.disabled = false; }
      },
    });
    area.replaceChildren(formulario);
  }

  consulta.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!token || buscar.disabled) return;
    const tentativa = ++navegacao;
    editandoId = '';
    const documento = cnpj.value.trim();
    buscar.disabled = true;
    estado.textContent = 'Consultando cadastro…';
    area.replaceChildren();
    try {
      const r = await api.consultarCliente(token, documento);
      if (!ativo || tentativa !== navegacao) return;
      if (!r.success) {
        if (r.error === 'sessao') { semSessao(); return; }
        if (r.error === 'nao_encontrado') {
          const rascunhos = await rascunhosCompativeis(null);
          if (!ativo || tentativa !== navegacao) return;
          estado.textContent = 'CNPJ não cadastrado no Essentials. Preencha os dados do supermercado.';
          oferecerCadastro(documento, rascunhos, tentativa, token);
          return;
        }
        estado.textContent = r.error === 'invalido' ? 'Confira o CNPJ.' : 'Não foi possível consultar o cliente.';
        return;
      }
      const catalogo = r.data;
      const rascunhos = await rascunhosCompativeis(catalogo.cliente.id);
      if (!ativo || tentativa !== navegacao) return;
      estado.textContent = `Cadastro encontrado: ${catalogo.cliente.nome}.`;
      oferecerVinculo(catalogo.cliente, catalogo, rascunhos);
    } catch { erroLocal(); }
    finally { buscar.disabled = false; }
  });
  novo.addEventListener('click', async () => {
    const catalogo = geral;
    if (!ativo || !catalogo || novo.disabled) return;
    const tentativa = ++navegacao;
    novo.disabled = true;
    try {
      const cliente = { id: null, nome: '' };
      const rascunho = await locais.criarRascunho({ cliente, itens: [] });
      if (ativo && tentativa === navegacao) editar(rascunho.vendaId, { ...catalogo, cliente }, rascunho.itens);
      await mostrarFila();
    } catch { erroLocal(); }
    finally { novo.disabled = false; }
  });
  let atualizandoCatalogo = false;
  async function atualizarCatalogo() {
    if (!token || !navigator.onLine || !ativo || atualizandoCatalogo) return;
    atualizandoCatalogo = true;
    try {
      const r = await api.catalogoGeral(token);
      if (!ativo || !r.success) return;
      guardarCatalogoGeral(usuario.id, r.data);
      geral = r.data;
      novo.hidden = !geral.apresentacoes.length;
    } catch { erroLocal(); }
    finally { atualizandoCatalogo = false; }
  }
  let atualizandoClientes = false;
  async function atualizarClientes() {
    if (!token || !navigator.onLine || !ativo || atualizandoClientes) return;
    atualizandoClientes = true;
    try {
      const r = await api.listarClientes(token);
      if (!ativo || !r.success) return;
      buscaClientes.atualizar(r.data.clientes);
      try { guardarClientes(usuario.id, r.data.clientes); } catch { /* A busca com a sessão aberta continua disponível. */ }
    } finally { atualizandoClientes = false; }
  }
  async function agendarSincronizacao() {
    if (sincronizando) repetir = true;
    else await sincronizar();
  }
  async function retomar() {
    await Promise.all([agendarSincronizacao(), atualizarCatalogo(), atualizarClientes()]);
  }
  const voltouAoApp = () => { if (document.visibilityState === 'visible') void retomar(); };
  tentar.addEventListener('click', () => void sincronizar());
  const parar = sincronizarAoRetomar(window, retomar);
  document.addEventListener('visibilitychange', voltouAoApp);
  return () => {
    ativo = false;
    parar();
    document.removeEventListener('visibilitychange', voltouAoApp);
    encerrar.abort();
    caixa.replaceChildren();
  };
}
