import type { Correcoes, PropostaCorrecao, criarAcompanhamento } from './tracking.js';

type Api = Pick<ReturnType<typeof criarAcompanhamento>, 'correcoes' | 'solicitarCorrecao'>;
type Opcoes = {
  api: Api; numero: number; sessaoAtual(): string | null; semSessao(): void;
};
const estados = { pendente: 'Aguardando autorização', aprovada: 'Aprovada', impedida: 'Impedida' };
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function texto<K extends keyof HTMLElementTagNameMap>(tag: K, conteudo: string): HTMLElementTagNameMap[K] {
  const elemento = document.createElement(tag);
  elemento.textContent = conteudo;
  return elemento;
}

function centavos(valor: string): number | null {
  const normalizado = valor.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalizado)) return null;
  const [reais = '', fracao = ''] = normalizado.split('.');
  return Number(reais) * 100 + Number(fracao.padEnd(2, '0'));
}

function historico(pedido: Correcoes): DocumentFragment {
  const resultado = document.createDocumentFragment();
  for (const registro of pedido.correcoes) {
    const bloco = document.createElement('section');
    bloco.append(texto('h4', `Correção nº ${registro.numero}`), texto('strong', estados[registro.situacao]), texto('p', registro.motivo));
    for (const item of registro.itens) {
      const exibir = (lado: typeof item.anterior) => `${lado.quantidade.replace('.', ',')} ${item.unidade} · ${moeda.format(lado.precoUnitarioCentavos / 100)}`;
      bloco.append(texto('p', item.apresentacao), texto('p', `Antes: ${exibir(item.anterior)}`),
        texto('p', `Proposta: ${exibir(item.proposta)}`));
    }
    resultado.append(bloco);
  }
  return resultado;
}

export function controlesDeCorrecao({ api, numero, sessaoAtual, semSessao }: Opcoes): HTMLElement {
  const bloco = document.createElement('div');
  const consultar = texto('button', 'Correções');
  consultar.type = 'button';
  consultar.className = 'secundario';
  const area = document.createElement('div');
  const aviso = document.createElement('p');
  aviso.setAttribute('role', 'status');
  bloco.append(consultar, aviso, area);
  let envio: PropostaCorrecao | null = null;
  let ocupado = false;

  async function carregar(token: string) {
    consultar.disabled = true;
    const r = await api.correcoes(token, numero);
    if (!bloco.isConnected || sessaoAtual() !== token) return;
    consultar.disabled = false;
    consultar.textContent = 'Atualizar correções';
    if (!r.success) {
      if (r.error === 'sessao') semSessao();
      else aviso.textContent = 'Não foi possível consultar as correções. Tente novamente.';
      return;
    }
    aviso.textContent = '';
    envio = null;
    area.replaceChildren(historico(r.data));
    if (r.data.podeSolicitar) area.append(formulario(token, r.data));
    else {
      const vigentes = document.createElement('ul');
      for (const item of r.data.itens) {
        vigentes.append(texto('li', `${item.apresentacao}: ${item.quantidade.replace('.', ',')} ${item.unidade} · ${moeda.format(item.precoUnitarioCentavos / 100)} por ${item.unidade}`));
      }
      area.prepend(texto('h4', 'Itens vigentes'), vigentes);
      if (!r.data.correcoes.some(({ situacao }) => situacao === 'pendente')) {
        area.prepend(texto('p', 'O pedido não pode mais ser corrigido após a primeira saída.'));
      }
    }
  }

  function formulario(token: string, pedido: Correcoes): HTMLFormElement {
    const form = document.createElement('form');
    const campos = document.createElement('fieldset');
    campos.append(texto('legend', 'Propor ajuste dos itens'));
    const entradas = pedido.itens.map((item) => {
      const qtd = texto('label', `Quantidade de ${item.apresentacao} (${item.unidade})`);
      const quantidade = document.createElement('input');
      quantidade.inputMode = item.unidade === 'kg' ? 'decimal' : 'numeric';
      quantidade.required = true;
      quantidade.maxLength = 10;
      quantidade.value = item.quantidade.replace('.', ',');
      qtd.append(quantidade);
      const preco = texto('label', `Preço unitário de ${item.apresentacao} (R$)`);
      const precoUnitario = document.createElement('input');
      precoUnitario.required = true;
      precoUnitario.inputMode = 'decimal';
      precoUnitario.maxLength = 10;
      precoUnitario.value = (item.precoUnitarioCentavos / 100).toFixed(2).replace('.', ',');
      preco.append(precoUnitario);
      campos.append(qtd, preco);
      return { item, quantidade, precoUnitario };
    });
    const label = texto('label', 'Motivo da correção');
    const motivo = document.createElement('input');
    motivo.required = true;
    motivo.maxLength = 240;
    label.append(motivo);
    campos.append(label);
    const solicitar = texto('button', 'Solicitar correção');
    solicitar.type = 'submit';
    form.append(texto('p', 'O pedido só muda se o gerente ou administrador aprovar.'), campos, solicitar);
    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      if (ocupado || !form.isConnected || sessaoAtual() !== token) return;
      if (!envio) {
        const itens: PropostaCorrecao['itens'] = [];
        for (const entrada of entradas) {
          const quantidade = entrada.quantidade.value.trim().replace(',', '.');
          const precoUnitarioCentavos = centavos(entrada.precoUnitario.value);
          const formato = entrada.item.unidade === 'kg' ? /^\d{1,6}(\.\d{1,3})?$/ : /^\d{1,6}$/;
          if (!formato.test(quantidade) || Number(quantidade) <= 0 || precoUnitarioCentavos === null) {
            aviso.textContent = 'Confira as quantidades e os preços unitários.';
            return;
          }
          if (Number(quantidade) !== Number(entrada.item.quantidade) || precoUnitarioCentavos !== entrada.item.precoUnitarioCentavos) {
            itens.push({ apresentacaoId: entrada.item.apresentacaoId, quantidade, precoUnitarioCentavos });
          }
        }
        if (!itens.length || !motivo.value.trim()) {
          aviso.textContent = 'Informe uma mudança e o motivo da correção.';
          return;
        }
        envio = { correcaoId: crypto.randomUUID(), motivo: motivo.value.trim(), itens };
      }
      aviso.textContent = 'Enviando solicitação…';
      ocupado = consultar.disabled = campos.disabled = solicitar.disabled = true;
      const r = await api.solicitarCorrecao(token, numero, envio);
      if (!form.isConnected || sessaoAtual() !== token) return;
      try {
        if (r.success || r.error === 'conflito') {
          await carregar(token);
          if (!r.success && sessaoAtual() === token) aviso.textContent = 'O pedido mudou. Confira os dados vigentes e as correções.';
        } else if (r.error === 'sessao') semSessao();
        else if (r.error === 'invalido') {
          aviso.textContent = 'Confira os dados da correção.';
          envio = null;
          campos.disabled = false;
        } else {
          aviso.textContent = 'Sem confirmação da solicitação. Tente novamente ou atualize as correções.';
          solicitar.textContent = 'Tentar confirmar solicitação';
        }
      } finally { ocupado = consultar.disabled = solicitar.disabled = false; }
    });
    return form;
  }

  consultar.addEventListener('click', () => {
    const token = sessaoAtual();
    if (token && !ocupado) void carregar(token);
  });
  return bloco;
}
