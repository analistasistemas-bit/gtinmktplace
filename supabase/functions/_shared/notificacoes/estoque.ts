// Alertas de estoque (ADR-0134): o saldo chegou a zero no canal e o anúncio saiu do ar, ou a
// reposição o trouxe de volta. Texto puro — quem descobre a transição é o `sincronizar-estoque`.
import { blocos } from './telegram.ts';

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
  /** ADR-0200: sem prova de que o canal recebeu o zero de todos os SKUs; omite a situação do anúncio. */
  semSituacao?: boolean;
  permalink: string | null;
}

/** "Azul (00000029)" quando há cor, senão o nome, senão só o código. */
function rotulo(v: VariacaoZerada): string {
  const nome = v.cor?.trim() || v.nome?.trim();
  return nome ? `${nome} (${v.codigo})` : v.codigo;
}

/** ADR-0195: a família tem cores sem anúncio no canal, e nada foi escrito. */
export function montarMensagemFamiliaSemItem(a: { produto: string | null; codigoPai: string; qtdCores: number }): string {
  const nome = a.produto?.trim() || a.codigoPai;
  return `⚠️ Estoque não enviado ao Mercado Livre: ${nome}\n`
    + `Produto ${a.codigoPai}: ${a.qtdCores} cor(es) sem anúncio confirmado. Nada foi enviado; precisa de correção manual.`;
}

/** ADR-0195: o teto cortou o que o anúncio mostra; o saldo real não mudou. */
export function montarMensagemTetoAnuncio(a: { codigoPai: string; itemExternoId: string; capados: number }): string {
  return `📦 Anúncio acima do limite do Mercado Livre: produto ${a.codigoPai}, anúncio ${a.itemExternoId}.\n`
    + `${a.capados} cor(es) aparecem com menos estoque no anúncio. O saldo real segue no PubliAI.`;
}

/** ADR-0195: o ML seguiu diferente do enviado depois das 3 leituras. Cita até 10 SKUs. */
export function montarMensagemConfirmacaoFalhou(a: {
  produto: string | null;
  codigoPai: string;
  divergentes: Array<{ sku: string; enviado: number; observado: number | null }>;
}): string {
  const nome = a.produto?.trim() || a.codigoPai;
  const resto = a.divergentes.length - 10;
  return blocos(
    [`⚠️ Estoque não confirmado no Mercado Livre: ${nome}`, `Produto ${a.codigoPai}: ${a.divergentes.length} SKU(s) diferente(s) do enviado.`],
    a.divergentes.slice(0, 10).map((d) => `• ${d.sku}: enviado ${d.enviado}, no ML ${d.observado ?? 'sem leitura'}`),
    resto > 0 ? [`E mais ${resto} SKU(s).`] : [],
  );
}

export function montarMensagemEstoqueZerado(a: EstoqueZeradoAlerta): string {
  const nome = a.produto?.trim() || a.codigoPai;
  const cabecalho = a.produtoInteiroZerado
    ? `📦 Estoque zerado: ${nome}`
    : a.zeradas.length === 1
    ? `📦 Estoque zerado numa variação de ${nome}`
    : `📦 Estoque zerado em ${a.zeradas.length} variações de ${nome}`;
  // ADR-0200: sem prova de que todo SKU do anúncio teve o zero confirmado no canal, avisa só o zerado local.
  const situacao = a.semSituacao ? []
    : a.produtoInteiroZerado
    ? ['Anúncio pausado no Mercado Livre.', 'Repor o estoque reativa o anúncio automaticamente.']
    : [`O anúncio segue no ar sem ${a.zeradas.length === 1 ? 'ela' : 'elas'}.`];
  return blocos([cabecalho], a.zeradas.map((v) => `• ${rotulo(v)}`), situacao, [a.permalink]);
}

export interface VoltaAoArAlerta {
  produto: string | null;
  codigoPai: string;
  permalink: string | null;
}

export function montarMensagemVoltaAoAr(a: VoltaAoArAlerta): string {
  const nome = a.produto?.trim() || a.codigoPai;
  return blocos(
    [`▶️ Voltou ao ar: ${nome}`],
    ['Estoque reposto, anúncio reativado no Mercado Livre.'],
    [a.permalink],
  );
}
