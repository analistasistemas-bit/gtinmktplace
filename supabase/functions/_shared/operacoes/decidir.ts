// ADR-0174 — decisão pura por item: dada a leitura fresca da campanha, o que fazer no ML (ou encerrar).
// Idempotente por construção: item já participando nunca é postado de novo.
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import { type Acao, type Decisao, type ItemNaCampanha, type OfertaNoItem, ofertaFixaNova, type PedidoItem, type Relacoes, type TipoPromocao } from './tipos.ts';
import { PRECO_MIN_RELAMPAGO } from './validar.ts';

const fim = (status: Extract<Decisao, { tipo: 'fim' }>['status'], mensagem: string | null = null): Decisao =>
  ({ tipo: 'fim', status, mensagem });

const reais = (n: number) => n.toFixed(2).replace('.', ',');
const faixaMudou = (min: number | null, max: number | null) => {
  const txt = (n: number | null) => (n === null ? '?' : reais(n));
  return fim('mudou', `A faixa de preço mudou: agora ${txt(min)} a ${txt(max)}`);
};

/** Relâmpago: faixa FECHADA (as duas visões), piso de R$ 19 e estoque = stock.min, nunca ausente. */
function aderirRelampago(
  promocaoId: string, p: number | null, fresco: ItemNaCampanha, relacoes: Relacoes | null, oferta: OfertaNoItem | null,
): Decisao {
  if (oferta == null) return fim('erro', 'O ML não informou a oferta deste anúncio na Relâmpago');
  // min conservador: o maior das duas visões (diferem no spike: campanha 8,70 × item 5,80).
  const mins = [fresco.preco_min, oferta.preco_min].filter((n): n is number => n !== null);
  const min = mins.length ? Math.max(...mins) : null;
  const max = oferta.preco_max;
  if (min === null || max === null) return fim('erro', 'O ML não informou a faixa de preço deste anúncio');
  if (p === null || p < min || p > max) return faixaMudou(min, max);
  if (p < PRECO_MIN_RELAMPAGO) return fim('bloqueado', 'Abaixo de R$ 19 o comprador perde o frete grátis');

  const e1 = fresco.estoque_min, e2 = oferta.estoque_min;
  if ((e1 === null && e2 === null) || (e1 !== null && e2 !== null && e1 !== e2)) {
    return fim('erro', 'O ML não informou o estoque mínimo da oferta');
  }
  const stock = (e1 ?? e2)!;
  const disponivel = relacoes?.disponivel;
  if (disponivel == null) return fim('bloqueado', 'O ML não informou o estoque disponível do anúncio');
  if (disponivel < stock) return fim('bloqueado', `Estoque disponível (${disponivel}) menor que o mínimo da Relâmpago (${stock})`);
  return { tipo: 'post', body: { promotion_id: promocaoId, promotion_type: 'LIGHTNING', deal_price: p, stock } };
}

/** Sair da Relâmpago: só `candidate` prova a saída; sumiço da campanha não vira ja_estava (espelharia sem prova). */
function sairRelampago(promocaoId: string, fresco: ItemNaCampanha | null): Decisao {
  if (fresco?.status === 'candidate') return fim('ja_estava');
  if (fresco === null || !ehParticipando(fresco.status)) {
    return fim('erro', 'O ML não mostra este anúncio na Relâmpago. Confira no Seller Center.');
  }
  if (!fresco.offer_id?.startsWith('OFFER-')) return fim('erro', 'O ML não informou a oferta deste anúncio');
  return {
    tipo: 'delete',
    query: `promotion_type=LIGHTNING&promotion_id=${promocaoId}&offer_id=${encodeURIComponent(fresco.offer_id)}&app_version=v2`,
  };
}

const centavos = (n: number) => Math.round(n * 100);

/** Oferta de preço fixo (emenda 2026-11-03): o POST leva só o offer_id, então o preço do ML tem de ser o do preview. */
function aderirOfertaFixa(
  tipo: 'SMART_LIGHTNING' | 'PRICE_MATCHING', promocaoId: string, p: number | null, fresco: ItemNaCampanha, relacoes: Relacoes | null,
): Decisao {
  if (!fresco.offer_id?.startsWith('CANDIDATE-')) return fim('erro', 'O ML não informou a oferta deste convite');
  const vivo = fresco.preco ?? null;
  if (vivo === null) return fim('erro', 'O ML não informou o preço da oferta');
  if (p === null || centavos(vivo) !== centavos(p)) return fim('mudou', `O preço da oferta mudou: agora ${reais(vivo)}`);
  if (vivo < PRECO_MIN_RELAMPAGO) return fim('bloqueado', 'Abaixo de R$ 19 o comprador perde o frete grátis');
  const body = { promotion_id: promocaoId, promotion_type: tipo, offer_id: fresco.offer_id };
  if (tipo === 'PRICE_MATCHING') return { tipo: 'post', body };

  const stock = fresco.estoque_min;
  if (stock === null) return fim('erro', 'O ML não informou o estoque mínimo da oferta');
  const disponivel = relacoes?.disponivel;
  if (disponivel == null) return fim('bloqueado', 'O ML não informou o estoque disponível do anúncio');
  if (disponivel < stock) return fim('bloqueado', `Estoque disponível (${disponivel}) menor que o mínimo da oferta (${stock})`);
  return { tipo: 'post', body: { ...body, stock } };
}

/** Sem evidência de saída nesta operação, `candidate` não prova nada: logo após aderir a visão atrasa ~2 min, e
 *  `ja_estava` espelharia uma saída falsa. A retomada com etapa gravada é do executor, não passa por aqui. */
function sairOfertaFixa(tipo: 'SMART_LIGHTNING' | 'PRICE_MATCHING', promocaoId: string, fresco: ItemNaCampanha | null): Decisao {
  if (fresco?.status === 'candidate') {
    return fim('mudou', 'O ML ainda mostra este anúncio como convidado. Se aderiu agora há pouco, aguarde 2 minutos e tente de novo.');
  }
  if (fresco === null || !ehParticipando(fresco.status)) return fim('erro', 'O ML não mostra este anúncio na campanha. Confira no Seller Center.');
  if (!fresco.offer_id?.startsWith('OFFER-')) return fim('erro', 'O ML não informou a oferta deste anúncio');
  return {
    tipo: 'delete',
    query: `promotion_type=${tipo}&promotion_id=${promocaoId}&offer_id=${encodeURIComponent(fresco.offer_id)}&app_version=v2`,
  };
}

/** Alterar preço (emenda 2026-11-03): só DEAL aceita PUT do deal_price (Relâmpago/SMART: sair e reaplicar / preço do
 *  ML). Idempotente pelo preço vivo; no Reverter, preço vivo ≠ o que a origem deixou → não sobrescreve. */
function alterarPreco(
  tipo: TipoPromocao, promocaoId: string, pedido: PedidoItem, fresco: ItemNaCampanha | null, participando: boolean,
): Decisao {
  if (tipo !== 'DEAL') return fim('bloqueado', 'Só campanhas tradicionais aceitam alterar o preço; saia e entre de novo');
  if (!participando) return fim('mudou', 'O anúncio não está mais participando desta promoção');
  const p = pedido.preco;
  if (p == null || !(p > 0)) return fim('erro', 'Informe o preço da oferta');
  const vivo = fresco!.preco ?? null;
  if (vivo != null && centavos(vivo) === centavos(p)) return fim('ja_estava');
  if (pedido.esperado != null && (vivo == null || centavos(vivo) !== centavos(pedido.esperado))) {
    return fim('mudou', 'O preço mudou desde a alteração original');
  }
  return { tipo: 'put', body: { promotion_id: promocaoId, promotion_type: 'DEAL', deal_price: p } };
}

export function decidir(
  acao: Acao, tipo: TipoPromocao, promocaoId: string, pedido: PedidoItem,
  fresco: ItemNaCampanha | null, relacoes: Relacoes | null, oferta?: OfertaNoItem | null,
): Decisao {
  const participando = fresco !== null && ehParticipando(fresco.status);

  if (acao === 'alterar_preco') return alterarPreco(tipo, promocaoId, pedido, fresco, participando);

  if (acao === 'sair') {
    if (tipo === 'LIGHTNING') return sairRelampago(promocaoId, fresco);
    if (ofertaFixaNova(tipo)) return sairOfertaFixa(tipo, promocaoId, fresco);
    if (!participando) return fim('ja_estava');
    if (tipo === 'DEAL') return { tipo: 'delete', query: `promotion_type=DEAL&promotion_id=${promocaoId}&app_version=v2` };
    if (!fresco.offer_id) return fim('erro', 'O ML não informou a oferta deste anúncio');
    return {
      tipo: 'delete',
      query: `promotion_type=SMART&promotion_id=${promocaoId}&offer_id=${encodeURIComponent(fresco.offer_id)}&app_version=v2`,
    };
  }

  if (participando) return fim('ja_estava');
  if (fresco === null || fresco.status !== 'candidate') return fim('mudou', 'O anúncio não é mais convidado nesta promoção');

  // Par User Product/catálogo: o ML só aceita a inscrição pelo anúncio de catálogo.
  const catalogo = relacoes && !relacoes.catalog_listing ? relacoes.relacionados.find((r) => r.catalog_listing) : undefined;
  if (catalogo) return fim('bloqueado', `Anúncio sincronizado com o de catálogo ${catalogo.id}: inscreva o de catálogo`);

  if (tipo === 'LIGHTNING') return aderirRelampago(promocaoId, pedido.preco, fresco, relacoes, oferta ?? null);
  if (ofertaFixaNova(tipo)) return aderirOfertaFixa(tipo, promocaoId, pedido.preco, fresco, relacoes);

  if (tipo === 'DEAL') {
    const { preco_min: min, preco_max: max } = fresco;
    const p = pedido.preco;
    const fora = p === null || (min !== null && max !== null && (p < min || p > max));
    // ponytail: preço nulo com faixa desconhecida reusa a mensagem de faixa; min/max null viram "?".
    if (fora) return faixaMudou(min, max);
    return { tipo: 'post', body: { promotion_id: promocaoId, promotion_type: 'DEAL', deal_price: p } };
  }

  if (!fresco.offer_id) return fim('erro', 'O ML não informou a oferta deste convite');
  return { tipo: 'post', body: { promotion_id: promocaoId, promotion_type: 'SMART', offer_id: fresco.offer_id } };
}

// indisponivel conta como vermelho (ADR-0174 decisão 5).
const PESO: Record<Semaforo, number> = { verde: 0, amarelo: 1, vermelho: 2, indisponivel: 2 };

/** O semáforo atual no preço pedido ficou pior que o gravado no preview? */
export function piorou(gravado: Semaforo, atual: Semaforo): boolean {
  return PESO[atual] > PESO[gravado];
}
