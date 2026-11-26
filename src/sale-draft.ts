export type Unidade = 'pacote' | 'caixa' | 'kg';

export type ItemRascunho = {
  apresentacaoId: number;
  unidade: Unidade;
  quantidade: string;
};

export type Precos = {
  padrao: Readonly<Record<number, number>>;
  cliente: Readonly<Record<number, number>>;
};

export type ItemConferido = Omit<ItemRascunho, 'quantidade'> & {
  quantidade: string | null;
  precoUnitarioCentavos: number | null;
  subtotalCentavos: number | null;
};

export type ConferenciaRascunho = {
  itens: ItemConferido[];
  totalCentavos: number | null;
};

export function conferirRascunho(
  itens: readonly ItemRascunho[],
  precos: Precos,
): ConferenciaRascunho {
  const conferidos = itens.map((item) => {
    const quantidade = normalizarQuantidade(item);
    const preco = precos.cliente[item.apresentacaoId] ?? precos.padrao[item.apresentacaoId];
    const precoUnitarioCentavos = preco !== undefined && Number.isInteger(preco)
      && preco >= 0 && preco <= 999_999_999 ? preco : null;

    return {
      apresentacaoId: item.apresentacaoId,
      unidade: item.unidade,
      quantidade,
      precoUnitarioCentavos,
      subtotalCentavos: calcularSubtotal(quantidade, precoUnitarioCentavos),
    };
  });

  let total = 0;
  for (const item of conferidos) {
    if (item.subtotalCentavos === null) return { itens: conferidos, totalCentavos: null };
    total += item.subtotalCentavos;
  }
  const distintas = new Set(conferidos.map((item) => item.apresentacaoId));
  const totalCentavos = conferidos.length > 0 && distintas.size === conferidos.length && Number.isSafeInteger(total)
    ? total : null;
  return { itens: conferidos, totalCentavos };
}

function normalizarQuantidade(item: ItemRascunho): string | null {
  const quantidade = item.quantidade.trim().replace(',', '.');
  const formato = item.unidade === 'kg' ? /^\d{1,6}(\.\d{1,3})?$/ : /^\d{1,6}$/;
  return formato.test(quantidade) && Number(quantidade) > 0 ? quantidade : null;
}

function calcularSubtotal(quantidade: string | null, preco: number | null): number | null {
  if (quantidade === null || preco === null) return null;
  const [inteiro = '', fracao = ''] = quantidade.split('.');
  const milesimos = BigInt(inteiro) * 1000n + BigInt(fracao.padEnd(3, '0'));
  return Number((milesimos * BigInt(preco) + 500n) / 1000n);
}

export type AlteracaoPreco = {
  apresentacaoId: number;
  anterior: Pick<ItemConferido, 'precoUnitarioCentavos' | 'subtotalCentavos'>;
  atual: Pick<ItemConferido, 'precoUnitarioCentavos' | 'subtotalCentavos'>;
};

export function compararPrecosDoRascunho(
  itens: readonly ItemRascunho[],
  precosAnteriores: Precos,
  precosAtuais: Precos,
): AlteracaoPreco[] {
  const anteriores = conferirRascunho(itens, precosAnteriores).itens;
  const alteracoes: AlteracaoPreco[] = [];
  for (const [indice, atual] of conferirRascunho(itens, precosAtuais).itens.entries()) {
    const anterior = anteriores[indice];
    if (anterior && anterior.precoUnitarioCentavos !== atual.precoUnitarioCentavos) {
      alteracoes.push({
        apresentacaoId: atual.apresentacaoId,
        anterior: {
          precoUnitarioCentavos: anterior.precoUnitarioCentavos,
          subtotalCentavos: anterior.subtotalCentavos,
        },
        atual: {
          precoUnitarioCentavos: atual.precoUnitarioCentavos,
          subtotalCentavos: atual.subtotalCentavos,
        },
      });
    }
  }
  return alteracoes;
}

