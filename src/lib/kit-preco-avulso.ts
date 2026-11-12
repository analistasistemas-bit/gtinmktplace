// ADR-0200 (adendo 08/11): referência do preço avulso das peças no kit com variação. Só compara preços de venda
// (soma das N peças avulsas × preço do kit); lucro e tarifa continuam no simulador (calcularTarifaML).

/** Promoção da peça com início depois de agora (aceita no ML). `preco` null = ainda sem preço legível. */
export interface PromocaoFutura { tipo: string; preco: number | null; inicio: string; fim: string | null }
/** Preço vivo de uma peça no ML. `normal` null = não lida. `promocao` null = sem promoção vigente. `futuras` ausente =
 *  resposta de uma edge anterior (sem a leitura): tratada como lista vazia, sem aviso. */
export interface PrecoPeca {
  normal: number | null; promocao: number | null; fimPromocao: string | null;
  futuras?: PromocaoFutura[]; futurasIndisponivel?: boolean;
}

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
  /** 2+ combinações, todas lidas, com a mesma soma normal e em promoção: a tela não marca nenhuma como "mais barata". */
  igualEmTodas: boolean;
}

const desconto = (preco: number, soma: number) => (soma > 0 ? Math.round((1 - preco / soma) * 100) : null);

export function compararKit(preco: number, linhas: LinhaAvulsa[]): ComparacaoKit {
  const ok = linhas.filter((l) => l.soma.disponivel);
  const semComparacao = ok.length < linhas.length;
  const igualEmTodas = !semComparacao && ok.length > 1 && ok.every((l) =>
    centavos(l.soma.normal) === centavos(ok[0].soma.normal) && centavos(l.soma.promocao) === centavos(ok[0].soma.promocao));
  const vazio = { pior: null, descontoNormal: null, descontoPromocao: null, maisCaro: false, referencia: null, fimPromocao: null, semComparacao, igualEmTodas };
  if (ok.length === 0) return vazio;
  // Empate em centavos: a combinação em promoção (a que pode mudar quando a promoção acabar).
  const pior = ok.reduce((a, b) => {
    const d = centavos(b.soma.promocao) - centavos(a.soma.promocao);
    return d < 0 || (d === 0 && b.soma.temPromocao && !a.soma.temPromocao) ? b : a;
  });
  // Sem preço digitado: a referência continua visível para o operador decidir.
  if (!(preco > 0)) return { ...vazio, pior };
  // Em centavos: 91,80 digitado contra soma 91,80 é "igual", não um float acima ou abaixo.
  const caras = ok.filter((l) => centavos(preco) >= centavos(l.soma.promocao));
  const maisCaro = caras.length > 0;
  return {
    pior,
    descontoNormal: desconto(preco, pior.soma.normal),
    descontoPromocao: desconto(preco, pior.soma.promocao),
    maisCaro,
    referencia: maisCaro ? pior.soma.promocao : null,
    // O aviso cita a soma da pior: só a data da promoção dela (a de outra combinação não muda o que o aviso diz).
    fimPromocao: maisCaro && pior.soma.temPromocao ? pior.soma.fimPromocao : null,
    semComparacao,
    igualEmTodas,
  };
}
