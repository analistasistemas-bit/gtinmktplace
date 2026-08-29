// Pulse (ADR-0119): derivações puras sobre snapshots de ofertas/vendedores. Sem I/O — testável
// sem mock de rede/Supabase.
import {
  resumirMercadoQualificado,
  type MercadoQualificado,
} from '../../supabase/functions/_shared/concorrencia/qualificacao';
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

/** Delta de `transactions_total` entre a 1ª e a última leitura — proxy de vendas do VENDEDOR
 *  inteiro (não do anúncio; ver Fatos empíricos do plano). Precisa de pelo menos 2 pontos. */
export function vendasEstimadasVendedor(hist: PulseVendedor[]): number | null {
  if (hist.length < 2) return null;
  const ordenado = [...hist].sort((a, b) => a.dia.localeCompare(b.dia));
  const primeiro = ordenado[0].transactions_total;
  const ultimo = ordenado[ordenado.length - 1].transactions_total;
  if (primeiro == null || ultimo == null) return null;
  return ultimo - primeiro;
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
