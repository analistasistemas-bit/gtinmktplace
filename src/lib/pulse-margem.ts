// Pulse (ADR-0119): derivações puras sobre snapshots de ofertas/vendedores. Sem I/O — testável
// sem mock de rede/Supabase.
import {
  resumirMercadoQualificado,
  type MercadoQualificado,
} from '../../supabase/functions/_shared/concorrencia/qualificacao';
import { mediaMensal12m } from '../../supabase/functions/_shared/pulse/vendas-mensais-vendedor';
import type { PulseOferta, PulseVendedor } from './pulse';

/** Junta cada oferta ao perfil mais recente de seu vendedor e aplica a regra compartilhada. */
export function mercadoPulse(
  ofertas: PulseOferta[],
  vendedores: PulseVendedor[],
): MercadoQualificado {
  const vendedorPorId = new Map<number, PulseVendedor>();
  for (const vendedor of vendedores) {
    const atual = vendedorPorId.get(vendedor.seller_id);
    const leituraAtual = atual?.perfil_coletado_em ?? atual?.dia;
    const leituraNova = vendedor.perfil_coletado_em ?? vendedor.dia;
    if (!atual || leituraNova >= leituraAtual!) vendedorPorId.set(vendedor.seller_id, vendedor);
  }

  return resumirMercadoQualificado(ofertas.map((oferta) => {
    const vendedor = vendedorPorId.get(oferta.seller_id);
    return {
      item_id: oferta.item_id,
      seller_id: oferta.seller_id,
      preco: oferta.preco,
      frete_gratis: oferta.frete_gratis,
      full: oferta.full_ml,
      transactions_total: vendedor?.transactions_total ?? null,
      visitas_30d: oferta.visitas_30d,
      nivel: vendedor?.nivel ?? null,
    };
  }));
}

/** Última linha por item (a mais recente por `dia`), só as ativas, ordenada por preço asc. */
export function estadoAtualOfertas(ofertas: PulseOferta[]): PulseOferta[] {
  const ultimaPorItem = new Map<string, PulseOferta>();
  for (const o of ofertas) {
    const atual = ultimaPorItem.get(o.item_id);
    if (!atual || o.dia > atual.dia) ultimaPorItem.set(o.item_id, o);
  }
  return [...ultimaPorItem.values()]
    .filter((o) => o.ativo)
    .sort((a, b) => a.preco - b.preco);
}

/** Menor preço entre as ofertas ativas de cada dia, em ordem cronológica. */
/**
 * Menor preço VIGENTE por dia. `pulse_ofertas` é histórico de **mudanças** — o coletor só grava a
 * oferta que mudou naquele dia —, então tirar o mínimo das linhas do dia responde "qual a mais
 * barata que mexeu hoje", não "qual a mais barata do mercado hoje".
 *
 * O efeito não era um número levemente errado: era uma **linha de tendência mentindo**. Num dia em
 * que só ofertas caras foram regravadas, o mínimo do dia subia e o gráfico desenhava uma alta que
 * não aconteceu. Medido em produção (Aptamil Premium 1, 2026-08-29): mínimo real R$ 36,00 desde
 * 20/08, gráfico marcando R$ 79,99 porque naquele dia só três ofertas caras mudaram.
 *
 * Aqui cada oferta carrega o último preço conhecido para os dias seguintes, até mudar ou ser
 * desativada. `atuais` (a view do estado atual) é a verdade do presente e governa o último ponto:
 * o histórico é limitado a 400 linhas e pode ter perdido a primeira aparição de alguma oferta.
 */
export function menorPrecoPorDia(
  ofertas: PulseOferta[],
  atuais?: PulseOferta[],
): { dia: string; preco: number }[] {
  const porDia = new Map<string, PulseOferta[]>();
  for (const o of ofertas) {
    const lista = porDia.get(o.dia) ?? [];
    lista.push(o);
    porDia.set(o.dia, lista);
  }

  const vigente = new Map<string, { preco: number; ativo: boolean }>();
  const serie: { dia: string; preco: number }[] = [];
  for (const dia of [...porDia.keys()].sort((a, b) => a.localeCompare(b))) {
    for (const o of porDia.get(dia)!) vigente.set(o.item_id, { preco: o.preco, ativo: o.ativo });
    let menor: number | null = null;
    for (const v of vigente.values()) {
      if (v.ativo && (menor == null || v.preco < menor)) menor = v.preco;
    }
    // Dia sem nenhuma oferta ativa não vira zero — some da série.
    if (menor != null) serie.push({ dia, preco: menor });
  }

  if (atuais?.length && serie.length) {
    const menorAtual = atuais.reduce<number | null>(
      (m, o) => (o.ativo && (m == null || o.preco < m) ? o.preco : m),
      null,
    );
    if (menorAtual != null) serie[serie.length - 1] = { dia: serie[serie.length - 1].dia, preco: menorAtual };
  }
  return serie;
}

/**
 * Comissão do ML para um preço, a partir da estrutura lida na coleta. `null` sem a estrutura —
 * comissão nunca é estimada por regra de três a partir de um valor pronto de outro preço, que foi
 * exatamente o defeito da Errata 6.
 */
export function comissaoNoPreco(
  preco: number,
  comissao: { pct: number | null; fixa: number | null } | null,
): number | null {
  if (comissao?.pct == null) return null;
  return (preco * comissao.pct) / 100 + (comissao.fixa ?? 0);
}

/**
 * A sobra exibida é exata ou estimativa? A estrutura da comissão vale só para a FAIXA do preço em
 * que foi lida (medido: 14% + R$ 4,99 fixo a R$ 10; 14% de R$ 25 a R$ 100; 11% a R$ 250), então
 * fora daquele preço o número é aproximado — e a tela precisa dizer, em vez de exibi-lo com a
 * mesma confiança de um valor exato.
 *
 * A âncora é `comissaoPreco`, não o preço atual do anúncio: quando o anúncio tem promoção, a
 * leitura pode ter sido feita no preço base, e ancorar no preço atual fazia justamente esse caso
 * sair SEM rótulo (Errata 7 do ADR-0119). `comissaoPreco` nulo é linha anterior à Errata 7 —
 * preço da leitura desconhecido, logo estimativa.
 */
export function margemEhEstimativa(
  precoSimulado: number | null,
  comissaoPreco: number | null,
): boolean {
  if (comissaoPreco == null || precoSimulado == null) return true;
  return Math.abs(precoSimulado - comissaoPreco) > 0.005;
}

/**
 * Margem líquida estimada: comissão do ML no preço + frete + imposto por origem + custo do
 * produto. QUALQUER insumo ausente → null (regra LOUD: margem nunca é exibida com dado assumido).
 *
 * A comissão vem da estrutura (percentual + fixo) lida para o preço praticado, não do valor
 * pronto de `ptw_custos` — aquele é calculado sobre o preço SUGERIDO pelo ML e superestimava a
 * sobra em todo anúncio acima da sugestão.
 */
export function margemEstimada(args: {
  preco: number; custoProduto: number | null;
  comissao: { pct: number | null; fixa: number | null } | null;
  frete: number | null;
  aliquotaPct: number | null;
}): { liquido: number; margemPct: number; comissao: number } | null {
  const { preco, custoProduto, frete, aliquotaPct } = args;
  const comissao = comissaoNoPreco(preco, args.comissao);
  if (custoProduto == null || comissao == null || frete == null || aliquotaPct == null) return null;
  const liquido = preco - comissao - frete - (preco * aliquotaPct) / 100 - custoProduto;
  const margemPct = (liquido / preco) * 100;
  return { liquido, margemPct, comissao };
}

export type TendenciaVendedor = 'crescendo' | 'estavel' | 'encolhendo';

export interface PorteVendedor {
  /** Média mensal dos últimos 12 meses da LOJA INTEIRA (ADR-0146 D-1). */
  mediaMensal: number;
  /** Sinal do delta contra o mesmo período de 12 meses atrás. `null` com menos de 2 leituras. */
  tendencia: TendenciaVendedor | null;
}

/**
 * Porte do vendedor, na MESMA definição que o Sonar usa (ADR-0146): `transactions_total ÷ 12`.
 *
 * O Radar mostrava o **delta** de `transactions_total` chamado de "≈N no período" — e o Spike 048
 * provou que esse campo é janela móvel de 365 dias, então o delta é *venda de agora menos venda do
 * mesmo período de um ano atrás*, não venda. Duas telas calculando contas diferentes do mesmo
 * campo e chamando as duas de venda era o defeito mais caro que a entrega do Sonar podia deixar
 * para trás (`docs/reference/licoes-joompulse-para-o-radar.md` §3).
 *
 * Continua sendo da **loja inteira**: venda por anúncio de terceiro não é obtenível (ADR-0142).
 */
export function porteDoVendedor(hist: PulseVendedor[]): PorteVendedor | null {
  if (hist.length === 0) return null;
  const ordenado = [...hist].sort((a, b) => a.dia.localeCompare(b.dia));
  const ultimo = ordenado[ordenado.length - 1].transactions_total;
  if (ultimo == null) return null;

  let tendencia: TendenciaVendedor | null = null;
  if (ordenado.length >= 2) {
    const primeiro = ordenado[0].transactions_total;
    if (primeiro != null) {
      const delta = ultimo - primeiro;
      tendencia = delta > 0 ? 'crescendo' : delta < 0 ? 'encolhendo' : 'estavel';
    }
  }
  return { mediaMensal: mediaMensal12m(ultimo), tendencia };
}

/**
 * Fatia de visitas deste anúncio entre os RELEVANTES. É a única medida por anúncio que a API
 * oficial dá (Errata 9 da ADR-0119), então é o melhor proxy de tração daquele anúncio — bem melhor
 * que "vendas na conta", que soma os anúncios do vendedor em nichos sem relação.
 *
 * **Não é fatia de mercado:** tráfego não é conversão, e não temos taxa de conversão. Anúncios com
 * visitas `null` (não medido) ficam fora do denominador — contá-los como zero afirmaria o que não
 * sabemos.
 */
export function shareDeVisitas(
  mercado: MercadoQualificado,
  visitasDoAnuncio: number | null,
): number | null {
  if (visitasDoAnuncio == null) return null;
  const total = mercado.ofertas.reduce(
    (soma, o) => (o.qualificacao.status === 'relevante' && o.visitas_30d != null ? soma + o.visitas_30d : soma),
    0,
  );
  return total > 0 ? (visitasDoAnuncio / total) * 100 : null;
}

export interface AbaixoDaReferencia {
  /** Quantas ofertas ativas estão abaixo da referência relevante. */
  contagem: number;
  /** A mais barata delas. */
  menorPreco: number;
  /** O menor relevante — o número que a tela usa para comparar preço. */
  referencia: number;
  pctAbaixo: number;
}

/**
 * Ofertas ativas abaixo da referência relevante. Elas não entram na comparação de preço, por
 * decisão da régua de qualificação (ADR-0020/0050) — perseguir preço de vendedor sem histórico
 * destrói margem atrás de quem não se sustenta. Mas elas existem, e o comprador as vê na mesma
 * página do catálogo: a tela precisa dizer que estão lá.
 *
 * **Não afirma quem leva a venda.** O ganhador do buy-box não é obtenível pela API do ML
 * (Spike 049: `buy_box_winner` null em 40 de 40) e o mais barato **não** é o ganhador — medido, ele
 * é em apenas 9 de 17 catálogos disputados. No Aptamil Premium 1 o mais barato está em R$ 36,00 e
 * o buy-box, em outra oferta de R$ 49,90.
 */
export function ofertasAbaixoDaReferencia(mercado: MercadoQualificado): AbaixoDaReferencia | null {
  const referencia = mercado.menor_relevante;
  if (referencia == null) return null;

  const abaixo = mercado.ofertas.filter(
    (o) => o.qualificacao.status !== 'relevante' && o.preco < referencia,
  );
  if (abaixo.length === 0) return null;

  const menorPreco = Math.min(...abaixo.map((o) => o.preco));
  return {
    contagem: abaixo.length,
    menorPreco,
    referencia,
    pctAbaixo: ((referencia - menorPreco) / referencia) * 100,
  };
}

export interface FamiliaComVariacoes {
  origem: string | null;
  variacoes: { custo: number | null }[] | null;
}

/**
 * Custo do produto e origem, a partir das famílias de um `codigo_pai` **já ordenadas da mais
 * recente para a mais antiga**. Uma função só, chamada pelo caminho unitário e pelo lote: duas
 * implementações da regra de custo divergem em silêncio, e divergência silenciosa em custo é a
 * família de defeito mais cara deste projeto.
 *
 * Família recém-criada (ainda sem variações gravadas) não pode se passar pela fonte de custo —
 * regra LOUD: cai em `null`, nunca em 0.
 */
export function custoDaFamilia(
  familias: FamiliaComVariacoes[],
): { custo: number | null; origem: string | null } {
  const familia = familias.find((f) => (f.variacoes ?? []).length > 0);
  if (!familia) return { custo: null, origem: null };
  const custos = (familia.variacoes ?? []).map((v) => v.custo).filter((c): c is number => c != null);
  return { custo: custos.length > 0 ? Math.max(...custos) : null, origem: familia.origem };
}

/**
 * As duas formas em que os custos do ML chegam a `insumoFaltante`: a linha de `pulse_produtos`
 * (lista e detalhe) e a estrutura de comissão do dialog de reprecificar. União, e não campos
 * opcionais, de propósito — com opcionais um objeto sem NENHUMA das duas formas passaria pelo
 * compilador e cairia em "falta comissão" para sempre, sem ninguém notar.
 */
export type CustosParaMargem =
  | { comissao_pct: number | null; ptw_custos: { frete: number | null } | null }
  | { comissaoPct: number | null; frete: number | null };

/**
 * Qual insumo impede o cálculo da margem. Vive aqui, e não na tela, porque a lista, o detalhe e o
 * reprecificar precisam responder a MESMA coisa para o mesmo produto — um `—` num lugar e um
 * número no outro seria contradição na mesma tela (ADR-0119 Errata 12 D-2). Estava duplicada como
 * função privada em `dialog-detalhe.tsx` e `dialog-reprecificar.tsx`.
 *
 * A comissão TEM que vir do percentual lido no preço praticado. Cair em `ptw_custos.comissao`
 * seria voltar ao defeito da Errata 6: aquele valor é calculado sobre o preço SUGERIDO pelo ML e
 * superestima a sobra em todo anúncio acima da sugestão.
 */
export function insumoFaltante(
  contexto: { custo: number | null; aliquotaPct: number | null } | undefined,
  produto: CustosParaMargem | null,
): string | null {
  if (!contexto || contexto.custo == null) return 'custo do produto';
  if (contexto.aliquotaPct == null) return 'alíquota de imposto';
  const emCamelCase = produto != null && 'comissaoPct' in produto;
  const comissaoPct = produto == null ? null
    : emCamelCase ? produto.comissaoPct : produto.comissao_pct;
  const frete = produto == null ? null
    : emCamelCase ? produto.frete : produto.ptw_custos?.frete ?? null;
  if (comissaoPct == null) return 'comissão do Mercado Livre';
  if (frete == null) return 'custo de frete do Mercado Livre';
  return null;
}
