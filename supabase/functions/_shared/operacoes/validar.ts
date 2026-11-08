// ADR-0174 — validação do pedido de operação em massa (criação). Puro: a tarifa exata entra por parâmetro.
import { ehParticipando, liquidoNoPreco, MSG_PISO_PROMOCAO, PRECO_MIN_PROMOCAO, semaforo, semaforoDaLinha } from '../promocoes/projecao.ts';
import type { ProjecaoCor, Semaforo } from '../promocoes/tipos.ts';
import { type Acao, ofertaFixaNova } from './tipos.ts';

/** Linha de `ml_promocao_itens` (Central) que a validação usa. */
export interface LinhaCentral {
  ml_item_id: string; status: string; titulo: string | null;
  preco_original: number | null; preco_min: number | null; preco_max: number | null; preco_sugerido: number | null; preco_promo: number | null;
  preco_avaliado: number | null; projecao: ProjecaoCor[];
  /** Relâmpago: participa num horário e tem convite aberto para outro (emenda 2026-11-08 (2)) → aderível. */
  convite_aberto?: boolean;
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
const TIPOS = new Set(['DEAL', 'SMART', 'LIGHTNING', 'SMART_LIGHTNING', 'PRICE_MATCHING']);
const reais = (n: number) => n.toFixed(2).replace('.', ',');
const centavos = (n: number) => Math.round(n * 100);

/** Semáforo no preço com a tarifa gravada na projeção (a do preço avaliado); cor sem dado → indisponivel. */
export function semaforoNoPreco(projecao: ProjecaoCor[], preco: number | null): Semaforo {
  if (preco == null) return 'indisponivel';
  return semaforoDaLinha(projecao, projecao.map((c) => {
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

/** Reverter de alterar_preco (achado Codex P1): só itens `aplicado` da origem, voltando exatamente ao preço que ela
 *  leu no ML antes de escrever. `esperados` = preço que a origem deixou (o executor compara com o vivo). */
export function reversaoAlterarValida(
  pedido: { ml_item_id: string; preco?: number | null }[],
  origem: { ml_item_id: string; status: string; preco: number | null; preco_anterior: number | null }[],
): { esperados: Map<string, number>; recusas: Recusa[] } {
  const porId = new Map(origem.map((o) => [o.ml_item_id, o]));
  const esperados = new Map<string, number>();
  const recusas: Recusa[] = [];
  for (const it of pedido) {
    const o = porId.get(it.ml_item_id);
    if (!o || o.status !== 'aplicado' || o.preco == null) {
      recusas.push({ ml_item_id: it.ml_item_id, motivo: 'O anúncio não foi alterado pela operação de origem' });
    } else if (o.preco_anterior == null) {
      recusas.push({ ml_item_id: it.ml_item_id, motivo: 'Sem preço anterior registrado para reverter' });
    } else if (it.preco == null || centavos(it.preco) !== centavos(o.preco_anterior)) {
      recusas.push({ ml_item_id: it.ml_item_id, motivo: `O Reverter volta ao preço anterior (${reais(o.preco_anterior)})` });
    } else {
      esperados.set(it.ml_item_id, o.preco);
    }
  }
  return { esperados, recusas };
}

export async function validarPedido(
  acao: Acao, tipo: string, itens: ItemPedido[], central: Map<string, LinhaCentral>, exato: SemaforoExato,
): Promise<{ ok: true; itens: PedidoValidado[] } | { ok: false; erro: string; itens?: Recusa[] }> {
  if (!TIPOS.has(tipo)) return { ok: false, erro: 'Este tipo de promoção ainda não aceita operação em massa.' };
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

    // Emenda 2026-11-03: participante não tem faixa (o ML valida e recusa com mensagem); o resto é a trava de sempre.
    if (acao === 'alterar_preco') {
      if (tipo !== 'DEAL') { recusar('Só campanhas tradicionais aceitam alterar o preço'); continue; }
      if (!ehParticipando(l.status)) { recusar('O anúncio não está Participando desta promoção'); continue; }
      const p = it.preco;
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) { recusar('Informe o preço da oferta'); continue; }
      const preco = centavos(p) / 100;
      if (l.preco_original != null && preco >= l.preco_original) {
        recusar(`O preço da promoção precisa ser menor que o original (${reais(l.preco_original)})`);
        continue;
      }
      if (preco < PRECO_MIN_PROMOCAO) { recusar(MSG_PISO_PROMOCAO); continue; }
      const s = await semaforoReal(l, preco, exato);
      if ((s === 'vermelho' || s === 'indisponivel') && !confirmado) {
        recusar('Resultado vermelho ou sem cálculo: confirme o risco para incluir', s);
        continue;
      }
      ok.push({ ml_item_id: id, titulo: l.titulo, preco, semaforo: s, confirmado_risco: confirmado });
      continue;
    }

    if (acao === 'sair') {
      if (!ehParticipando(l.status)) { recusar('O anúncio não está Participando desta promoção'); continue; }
      ok.push({ ml_item_id: id, titulo: l.titulo, preco: null, semaforo: null, confirmado_risco: confirmado });
      continue;
    }

    if (l.status !== 'candidate' && !(tipo === 'LIGHTNING' && l.convite_aberto)) { recusar('O anúncio não está como Convidado nesta promoção'); continue; }
    let preco: number | null;
    if (tipo === 'DEAL' || tipo === 'LIGHTNING') {
      const p = it.preco;
      if (typeof p !== 'number' || !Number.isFinite(p)) { recusar('Informe o preço da oferta'); continue; }
      if (l.preco_min == null || l.preco_max == null) { recusar('O ML não informou a faixa de preço deste anúncio'); continue; }
      if (p < l.preco_min || p > l.preco_max) {
        recusar(`Preço fora da faixa do ML (${reais(l.preco_min)} a ${reais(l.preco_max)})`);
        continue;
      }
      // Piso fica antes do semáforo: risco confirmado não libera.
      if (p < PRECO_MIN_PROMOCAO) { recusar(MSG_PISO_PROMOCAO); continue; }
      preco = p;
    } else if (ofertaFixaNova(tipo)) {
      // Preço fixo do ML: o exibido no preview (it.preco) precisa ser o da Central; decidir compara com a leitura fresca.
      const atual = l.preco_promo;
      if (atual == null) { recusar('O ML não informou o preço da oferta'); continue; }
      if (typeof it.preco !== 'number' || centavos(it.preco) !== centavos(atual)) { recusar(`O preço da oferta mudou: agora ${reais(atual)}`); continue; }
      if (atual < PRECO_MIN_PROMOCAO) { recusar(MSG_PISO_PROMOCAO); continue; }
      preco = it.preco;
    } else {
      preco = l.preco_promo; // SMART: o preço é o da oferta do ML (informativo)
      if (preco == null) { recusar('O ML não informou o preço da oferta'); continue; }
      if (preco < PRECO_MIN_PROMOCAO) { recusar(MSG_PISO_PROMOCAO); continue; }
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
