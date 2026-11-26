import type { NovoClienteCampo } from './tracking.js';

const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function campo(label: string, opcoes: {
  maxLength: number; autocomplete?: string; inputMode?: string; opcional?: boolean; type?: string;
}) {
  const rotulo = document.createElement('label');
  rotulo.textContent = label;
  const input = document.createElement('input');
  input.maxLength = opcoes.maxLength;
  input.required = !opcoes.opcional;
  if (opcoes.autocomplete) input.setAttribute('autocomplete', opcoes.autocomplete);
  if (opcoes.inputMode) input.inputMode = opcoes.inputMode;
  if (opcoes.type) input.type = opcoes.type;
  rotulo.append(input);
  return { rotulo, input };
}

type Opcoes = {
  cnpj: string;
  escolha: { rotulo: HTMLLabelElement; alvo: HTMLSelectElement };
  sugerirNome(vendaId: string): string;
  cadastrar(dados: NovoClienteCampo, vendaId: string): Promise<string | void>;
};

export function formularioNovoCliente({ cnpj, escolha, sugerirNome, cadastrar }: Opcoes): HTMLFormElement {
  const form = document.createElement('form');
  form.setAttribute('aria-label', 'Novo supermercado');
  const campos = document.createElement('fieldset');
  const titulo = document.createElement('legend');
  titulo.textContent = 'Novo supermercado';
  const documento = campo('CNPJ consultado', { maxLength: 18 });
  documento.input.value = cnpj;
  documento.input.readOnly = true;
  const nome = campo('Nome do supermercado', { maxLength: 120, autocomplete: 'organization' });
  const telefone = campo('Telefone com DDD', { maxLength: 20, autocomplete: 'tel-national', type: 'tel' });
  const cep = campo('CEP', { maxLength: 9, autocomplete: 'postal-code', inputMode: 'numeric' });
  const logradouro = campo('Logradouro', { maxLength: 120, autocomplete: 'address-line1' });
  const numero = campo('Número', { maxLength: 20 });
  const semNumero = document.createElement('input');
  semNumero.type = 'checkbox';
  const opcaoSemNumero = document.createElement('label');
  opcaoSemNumero.className = 'opcao';
  opcaoSemNumero.append(semNumero, 'Sem número');
  semNumero.addEventListener('change', () => {
    numero.input.required = !semNumero.checked;
    numero.input.disabled = semNumero.checked;
  });
  const complemento = campo('Complemento (opcional)', { maxLength: 120, autocomplete: 'address-line2', opcional: true });
  const bairro = campo('Bairro', { maxLength: 120 });
  const municipio = campo('Município', { maxLength: 120, autocomplete: 'address-level2' });
  const uf = document.createElement('select');
  uf.autocomplete = 'address-level1';
  uf.required = true;
  uf.add(new Option('Selecione a UF', ''));
  for (const sigla of ufs) uf.add(new Option(sigla, sigla));
  const rotuloUf = document.createElement('label');
  const nomeUf = document.createElement('span');
  nomeUf.id = 'novo-supermercado-uf';
  nomeUf.textContent = 'UF';
  uf.setAttribute('aria-labelledby', nomeUf.id);
  rotuloUf.append(nomeUf, uf);
  let nomeSugerido = sugerirNome(escolha.alvo.value);
  nome.input.value = nomeSugerido;
  escolha.alvo.addEventListener('change', () => {
    const anterior = nomeSugerido;
    nomeSugerido = sugerirNome(escolha.alvo.value);
    if (!nome.input.value.trim() || nome.input.value === anterior) nome.input.value = nomeSugerido;
  });

  campos.append(titulo, documento.rotulo, escolha.rotulo, nome.rotulo, telefone.rotulo, cep.rotulo,
    logradouro.rotulo, numero.rotulo, opcaoSemNumero, complemento.rotulo, bairro.rotulo, municipio.rotulo, rotuloUf);
  const aviso = document.createElement('p');
  aviso.setAttribute('role', 'status');
  const salvar = document.createElement('button');
  salvar.type = 'submit';
  salvar.textContent = 'Cadastrar supermercado';
  form.append(campos, aviso, salvar);
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (salvar.disabled || !form.isConnected) return;
    const valorComplemento = complemento.input.value.trim();
    const dados = {
      cnpj, nome: nome.input.value.trim(), telefone: telefone.input.value.trim(),
      endereco: {
        cep: cep.input.value.trim(), logradouro: logradouro.input.value.trim(),
        numero: semNumero.checked ? null : numero.input.value.trim(),
        bairro: bairro.input.value.trim(), municipio: municipio.input.value.trim(), uf: uf.value,
        ...(valorComplemento && { complemento: valorComplemento }),
      },
    };
    if (!dados.nome || !dados.endereco.logradouro || !dados.endereco.bairro || !dados.endereco.municipio
      || dados.endereco.numero === '' || !/^\d{5}-?\d{3}$/.test(dados.endereco.cep)
      || !/^(?:\+55 ?)?[()\d -]{10,20}$/.test(dados.telefone)
      || !/^[1-9]\d{9,10}$/.test(dados.telefone.replace(/^\+55 ?/, '').replace(/\D/g, ''))) {
      aviso.textContent = 'Confira o endereço e informe um telefone fixo ou celular com DDD.';
      return;
    }
    aviso.textContent = 'Cadastrando supermercado…';
    const vendaId = escolha.alvo.value;
    salvar.disabled = campos.disabled = true;
    try {
      const erro = await cadastrar(dados, vendaId);
      if (form.isConnected) aviso.textContent = erro ?? '';
    } finally { salvar.disabled = campos.disabled = false; }
  });
  return form;
}
