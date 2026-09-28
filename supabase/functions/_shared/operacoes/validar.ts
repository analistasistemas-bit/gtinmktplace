// ADR-0174 — validação do pedido de operação em massa (criação). Puro: a tarifa exata entra por parâmetro.
import { ehParticipando, liquidoNoPreco, piorSemaforo, semaforo } from '../promocoes/projecao.ts';
import type { ProjecaoCor, Semaforo } from '../promocoes/tipos.ts';
import type { Acao } from './tipos.ts';

/** Linha de `ml_promocao_itens` (Central) que a validação usa. */
export interface LinhaCentral {
  ml_item_id: string; status: string; titulo: string | null;
  preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; preco_promo: number | null;
  preco_avaliado: number | null; projecao: ProjecaoCor[];
}
export interface ItemPedido { ml_item_id: string; preco?: number | null; confirmado_risco?: boolean }
export interface PedidoValidado {
  ml_item_id: string; titulo: string | null; preco: number | null;
  semaforo: Semaforo | null;   // null em `sair`: sair não cria prejuízo
  confirmado_risco: boolean;
}
export interface Recusa { ml_item_id: string; motivo: string; semaforo?: Semaforo }
/** Semáforo com a tarifa EXATA do preço pedido (comissão fixa e frete mudam por faixa de preço). */
export type SemaforoExato = (linha: LinhaCentral, preco: number) => Promise<Semaforo>;

export const MAX_ITENS = 500;
const TIPOS = new Set(['DEAL', 'SMART']);
const reais = (n: number) => n.toFixed(2).replace('.', ',');
const centavos = (n: number) => Math.round(n * 100);

/** Semáforo no preço com a tarifa gravada na projeção (a do preço avaliado); cor sem dado → indisponivel. */
export function semaforoNoPreco(projecao: ProjecaoCor[], preco: number | null): Semaforo {
  if (preco == null) return 'indisponivel';
  return piorSemaforo(projecao.map((c) => {
    if (c.comissao_pct == null || c.frete == null || c.aliquota_pct == null || c.custo == null) return 'indisponivel';
    const liquido = liquidoNoPreco(preco, { comissao: { percentual: c.comissao_pct, fixa: c.comissao_fixa ?? 0 }, frete: c.frete }, c.aliquota_pct);
    return semaforo(liquido, c.piso ?? c.custo, c.custo);
  }));
}

/** Preço = avaliado (em centavos) → projeção gravada; senão → tarifa exata daquele preço (Ajuste 5). */
export function semaforoReal(l: LinhaCentral, preco: number | null, exato: SemaforoExato): Promise<Semaforo> {
  if (preco == null) return Promise.resolve('indisponivel');
  if (l.preco_avaliado != null && centavos(preco) === centavos(l.preco_avaliado)) {
    return Promise.resolve(semaforoNoPreco(l.projecao, preco));
  }
  return exato(l, preco);
}

export async function validarPedido(
  acao: Acao, tipo: string, itens: ItemPedido[], central: Map<string, LinhaCentral>, exato: SemaforoExato,
): Promise<{ ok: true; itens: PedidoValidado[] } | { ok: false; erro: string; itens?: Recusa[] }> {
  if (!TIPOS.has(tipo)) return { ok: false, erro: 'Só promoções DEAL e SMART aceitam operação em massa.' };
  if (!itens.length) return { ok: false, erro: 'Selecione ao menos um anúncio.' };
  if (itens.length > MAX_ITENS) return { ok: false, erro: `No máximo ${MAX_ITENS} anúncios por operação.` };

  const ok: PedidoValidado[] = [];
  const recusas: Recusa[] = [];
  const vistos = new Set<string>();
  for (const it of itens) {
    const id = it.ml_item_id;
    const recusar = (motivo: string, s?: Semaforo) => recusas.push({ ml_item_id: id, motivo, ...(s ? { semaforo: s } : {}) });
    if (vistos.has(id)) { recusar('Anúncio repetido no pedido'); continue; }
    vistos.add(id);
    const l = central.get(id);
    if (!l) { recusar('O anúncio não está nesta promoção na Central'); continue; }
    const confirmado = it.confirmado_risco === true;

    if (acao === 'sair') {
      if (!ehParticipando(l.status)) { recusar('O anúncio não está Participando desta promoção'); continue; }
      ok.push({ ml_item_id: id, titulo: l.titulo, preco: null, semaforo: null, confirmado_risco: confirmado });
      continue;
    }

    if (l.status !== 'candidate') { recusar('O anúncio não está como Convidado nesta promoção'); continue; }
    let preco: number | null;
    if (tipo === 'DEAL') {
      const p = it.preco;
      if (typeof p !== 'number' || !Number.isFinite(p)) { recusar('Informe o preço da oferta'); continue; }
      if (l.preco_min == null || l.preco_max == null) { recusar('O ML não informou a faixa de preço deste anúncio'); continue; }
      if (p < l.preco_min || p > l.preco_max) {
        recusar(`Preço fora da faixa do ML (${reais(l.preco_min)} a ${reais(l.preco_max)})`);
        continue;
      }
      preco = p;
    } else {
      preco = l.preco_promo; // SMART: o preço é o da oferta do ML (informativo)
    }
    // Trava financeira: vermelho/indisponivel só entra com o risco confirmado (checkbox separado no preview).
    const s = await semaforoReal(l, preco, exato);
    if ((s === 'vermelho' || s === 'indisponivel') && !confirmado) {
      recusar('Resultado vermelho ou sem cálculo: confirme o risco para incluir', s);
      continue;
    }
    ok.push({ ml_item_id: id, titulo: l.titulo, preco, semaforo: s, confirmado_risco: confirmado });
  }
  return recusas.length ? { ok: false, erro: 'Alguns anúncios não podem entrar na operação.', itens: recusas } : { ok: true, itens: ok };
}
