// ADR-0200 (adendo 08/11): referência do preço avulso das peças no kit com variação. Só compara preços de venda
// (soma das N peças avulsas × preço do kit); lucro e tarifa continuam no simulador (calcularTarifaML).

/** Preço vivo de uma peça no ML. `normal` null = não lida. `promocao` null = sem promoção vigente. */
export interface PrecoPeca { normal: number | null; promocao: number | null; fimPromocao: string | null }

export interface SomaAvulsa {
  normal: number;
  /** Peça sem promoção entra pelo normal: é o que o comprador paga avulso hoje. */
  promocao: number;
  temPromocao: boolean;
  /** Fim mais próximo entre as promoções das peças (ISO), ou null. */
  fimPromocao: string | null;
  /** false = alguma peça sem leitura: os números não valem. */
  disponivel: boolean;
}

const centavos = (n: number) => Math.round(n * 100);
const INDISPONIVEL: SomaAvulsa = { normal: 0, promocao: 0, temPromocao: false, fimPromocao: null, disponivel: false };

export function somaAvulsa(
  pecas: { codigo: string; cor: string; tamanho: string | null }[],
  precos: Map<string, PrecoPeca> | undefined,
  cores: string[],
  tamanho: string,
): SomaAvulsa {
  if (!precos) return INDISPONIVEL;
  let normal = 0; let promocao = 0; let temPromocao = false; let fim: string | null = null;
  for (const cor of cores) {
    const peca = pecas.find((p) => p.cor === cor && p.tamanho === tamanho);
    const p = peca && precos.get(peca.codigo);
    if (!p || p.normal == null) return INDISPONIVEL;
    normal += centavos(p.normal);
    if (p.promocao != null && centavos(p.promocao) < centavos(p.normal)) {
      promocao += centavos(p.promocao); temPromocao = true;
      if (p.fimPromocao && (!fim || p.fimPromocao < fim)) fim = p.fimPromocao;
    } else promocao += centavos(p.normal);
  }
  return { normal: normal / 100, promocao: promocao / 100, temPromocao, fimPromocao: fim, disponivel: true };
}

export interface LinhaAvulsa { rotulo: string; tamanho: string; soma: SomaAvulsa }
export interface ComparacaoKit {
  /** Combinação de menor soma em promoção (a que mais aperta o kit), entre as comparáveis. */
  pior: LinhaAvulsa | null;
  /** % do kit abaixo da soma normal / em promoção da pior (negativo = acima). */
  descontoNormal: number | null;
  descontoPromocao: number | null;
  /** Kit ≥ soma avulsa (promoção, ou normal sem promoção) em alguma combinação comparável. */
  maisCaro: boolean;
  /** Soma avulsa da pior combinação em que o kit sai mais caro. */
  referencia: number | null;
  fimPromocao: string | null;
  /** Alguma combinação sem leitura de preço: não foi possível comparar todas. */
  semComparacao: boolean;
}

const desconto = (preco: number, soma: number) => (soma > 0 ? Math.round((1 - preco / soma) * 100) : null);

export function compararKit(preco: number, linhas: LinhaAvulsa[]): ComparacaoKit {
  const ok = linhas.filter((l) => l.soma.disponivel);
  const semComparacao = ok.length < linhas.length;
  if (ok.length === 0 || !(preco > 0)) {
    return { pior: null, descontoNormal: null, descontoPromocao: null, maisCaro: false, referencia: null, fimPromocao: null, semComparacao };
  }
  const pior = ok.reduce((a, b) => (b.soma.promocao < a.soma.promocao ? b : a));
  // Em centavos: 91,80 digitado contra soma 91,80 é "igual", não um float acima ou abaixo.
  const caras = ok.filter((l) => centavos(preco) >= centavos(l.soma.promocao));
  const maisCaro = caras.length > 0;
  const fims = ok.map((l) => l.soma.fimPromocao).filter((f): f is string => !!f).sort();
  return {
    pior,
    descontoNormal: desconto(preco, pior.soma.normal),
    descontoPromocao: desconto(preco, pior.soma.promocao),
    maisCaro,
    referencia: maisCaro ? pior.soma.promocao : null,
    fimPromocao: fims[0] ?? null,
    semComparacao,
  };
}
