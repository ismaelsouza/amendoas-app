import type { ClienteDeCampo } from './tracking.js';

const limite = 8;
const nomeBusca = (valor: string) => valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const documentoBusca = (valor: string) => valor.toUpperCase().replace(/[./\s-]/g, '');
const exibirCnpj = (cnpj: string) => cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');

export function montarBuscaCliente(escolher: (cliente: ClienteDeCampo) => void): {
  elemento: HTMLElement; atualizar(clientes: ClienteDeCampo[]): void;
} {
  const elemento = document.createElement('div');
  const rotulo = document.createElement('label');
  rotulo.textContent = 'Buscar cliente por nome ou CNPJ';
  const campo = document.createElement('input');
  campo.type = 'search';
  campo.autocomplete = 'off';
  campo.maxLength = 120;
  campo.placeholder = 'Comece a digitar';
  campo.setAttribute('aria-controls', 'clientes-encontrados');
  rotulo.append(campo);
  const lista = document.createElement('ul');
  lista.id = 'clientes-encontrados';
  lista.className = 'sugestoes-clientes';
  lista.setAttribute('aria-label', 'Clientes encontrados');
  const aviso = document.createElement('p');
  aviso.setAttribute('role', 'status');
  elemento.append(rotulo, lista, aviso);
  let clientes: ClienteDeCampo[] | null = null;

  function mostrar() {
    const termo = nomeBusca(campo.value);
    const documento = documentoBusca(campo.value);
    lista.replaceChildren();
    aviso.textContent = '';
    if (!termo) return;
    if (!clientes) {
      aviso.textContent = 'A lista de clientes ainda não está disponível neste aparelho.';
      return;
    }
    const encontrados = clientes.filter(({ nome, cnpj }) => nomeBusca(nome).includes(termo)
      || (documento && cnpj?.includes(documento)));
    if (!encontrados.length) aviso.textContent = 'Nenhum cliente encontrado na lista. Para conferir um cadastro novo, consulte o CNPJ completo com internet.';
    else if (encontrados.length > limite) aviso.textContent = 'Digite mais para limitar os resultados.';
    for (const cliente of encontrados.slice(0, limite)) {
      const item = document.createElement('li');
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'secundario';
      const nome = document.createElement('strong');
      nome.textContent = cliente.nome;
      const doc = document.createElement('small');
      doc.textContent = cliente.cnpj ? exibirCnpj(cliente.cnpj) : 'Sem CNPJ no cadastro';
      botao.append(nome, doc);
      botao.addEventListener('click', () => {
        campo.value = '';
        mostrar();
        escolher(cliente);
      });
      item.append(botao);
      lista.append(item);
    }
  }

  campo.addEventListener('input', mostrar);
  return { elemento, atualizar(dados) { clientes = dados; mostrar(); } };
}
