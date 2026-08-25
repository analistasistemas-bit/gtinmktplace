// Alertas de estoque (ADR-0134): o saldo chegou a zero no canal e o anúncio saiu do ar, ou a
// reposição o trouxe de volta. Texto puro — quem descobre a transição é o `sincronizar-estoque`.

export interface VariacaoZerada {
  codigo: string;
  nome: string | null;
  cor: string | null;
}

export interface EstoqueZeradoAlerta {
  /** Nome do produto (familias.nome_pai); cai no código quando não há nome. */
  produto: string | null;
  codigoPai: string;
  zeradas: VariacaoZerada[];
  /** Todas as variações do produto estão em zero — é o caso em que o ML pausa o anúncio. */
  produtoInteiroZerado: boolean;
  permalink: string | null;
}

/** "Azul (00000029)" quando há cor, senão o nome, senão só o código. */
function rotulo(v: VariacaoZerada): string {
  const nome = v.cor?.trim() || v.nome?.trim();
  return nome ? `${nome} (${v.codigo})` : v.codigo;
}

export function montarMensagemEstoqueZerado(a: EstoqueZeradoAlerta): string {
  const nome = a.produto?.trim() || a.codigoPai;
  const linhas = a.zeradas.map((v) => `• ${rotulo(v)}`);
  const cabecalho = a.produtoInteiroZerado
    ? `📦 Estoque zerado: ${nome} — anúncio pausado no Mercado Livre.`
    : a.zeradas.length === 1
    ? `📦 Estoque zerado numa variação de ${nome} — o anúncio segue no ar sem ela.`
    : `📦 Estoque zerado em ${a.zeradas.length} variações de ${nome} — o anúncio segue no ar sem elas.`;
  const rodape = a.produtoInteiroZerado
    ? 'Repor o estoque reativa o anúncio automaticamente.'
    : null;
  return [cabecalho, ...linhas, rodape, a.permalink].filter(Boolean).join('\n');
}

export interface VoltaAoArAlerta {
  produto: string | null;
  codigoPai: string;
  permalink: string | null;
}

export function montarMensagemVoltaAoAr(a: VoltaAoArAlerta): string {
  const nome = a.produto?.trim() || a.codigoPai;
  return [
    `▶️ ${nome} voltou ao ar no Mercado Livre — estoque reposto, anúncio reativado.`,
    a.permalink,
  ].filter(Boolean).join('\n');
}
