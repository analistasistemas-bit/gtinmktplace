// ADR-0174 — decisão pura por item: dada a leitura fresca da campanha, o que fazer no ML (ou encerrar).
// Idempotente por construção: item já participando nunca é postado de novo.
import { ehParticipando } from '../promocoes/projecao.ts';
import type { Semaforo } from '../promocoes/tipos.ts';
import type { Acao, Decisao, ItemNaCampanha, PedidoItem, Relacoes, TipoPromocao } from './tipos.ts';

const fim = (status: Extract<Decisao, { tipo: 'fim' }>['status'], mensagem: string | null = null): Decisao =>
  ({ tipo: 'fim', status, mensagem });

const reais = (n: number) => n.toFixed(2).replace('.', ',');

export function decidir(
  acao: Acao, tipo: TipoPromocao, promocaoId: string, pedido: PedidoItem,
  fresco: ItemNaCampanha | null, relacoes: Relacoes | null,
): Decisao {
  const participando = fresco !== null && ehParticipando(fresco.status);

  if (acao === 'sair') {
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

  if (tipo === 'DEAL') {
    const { preco_min: min, preco_max: max } = fresco;
    const p = pedido.preco;
    const fora = p === null || (min !== null && max !== null && (p < min || p > max));
    // ponytail: preço nulo com faixa desconhecida reusa a mensagem de faixa; min/max null viram "?".
    if (fora) {
      const txt = (n: number | null) => (n === null ? '?' : reais(n));
      return fim('mudou', `A faixa de preço mudou: agora ${txt(min)} a ${txt(max)}`);
    }
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
