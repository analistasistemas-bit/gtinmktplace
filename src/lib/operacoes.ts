// ADR-0174 — operações em massa (aderir/sair de promoções DEAL/SMART do ML, pausar/reativar e reajustar preço — I5): regras puras do front.
import { calcularSemaforo, type Semaforo } from '@/lib/semaforo';
import { ateQuantoDaLinha, type CorProjetada, type ItemPromocao } from '@/lib/promocoes';
import type { PublicadoItem } from '@/lib/publicados';

export type AcaoPromocao = 'aderir' | 'sair';
export type AcaoStatus = 'pausar' | 'reativar';
export type AcaoOperacao = AcaoPromocao | AcaoStatus | 'reajustar';
export const ehAcaoStatus = (a: string): a is AcaoStatus => a === 'pausar' || a === 'reativar';
export type StatusItemOperacao =
  | 'rascunho' | 'pendente' | 'enviando' | 'conferindo'
  | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';

export interface LinhaPreview {
  ml_item_id: string; titulo: string | null; preco: number | null; min: number | null; max: number | null;
  sugerido: number | null; ateQuanto: number | null; semaforo: Semaforo; marcado: boolean;
}

const PESO: Record<Semaforo, number> = { indisponivel: 0, verde: 1, amarelo: 2, vermelho: 3 };
const piorSemaforo = (cores: Semaforo[]) => cores.reduce<Semaforo>((pior, s) => (PESO[s] > PESO[pior] ? s : pior), 'indisponivel');

/** "18,50" ou "18.5" → 18.5; vazio/inválido → null. */
export function parsePreco(txt: string): number | null {
  const t = txt.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Mesma fórmula de `_shared/preco/liquido.ts#liquidoClassico`, amarrada por teste de paridade com
 *  `_shared/operacoes/validar.ts#semaforoNoPreco`. */
function liquidoNoPreco(preco: number, pct: number, fixa: number, frete: number, aliquotaPct: number): number {
  return preco - (preco * pct / 100 + fixa) - frete - preco * aliquotaPct / 100;
}

/** Semáforo no preço com a tarifa gravada na projeção (paridade com o backend). */
export function semaforoNoPreco(projecao: CorProjetada[], preco: number | null): Semaforo {
  if (preco == null) return 'indisponivel';
  if (projecao.some((c) => c.motivo?.startsWith('kit_'))) return 'indisponivel'; // espelha semaforoDaLinha do backend
  return piorSemaforo(projecao.map((c) => {
    if (c.comissao_pct == null || c.frete == null || c.aliquota_pct == null || c.custo == null) return 'indisponivel';
    const liquido = liquidoNoPreco(preco, c.comissao_pct, c.comissao_fixa ?? 0, c.frete, c.aliquota_pct);
    return calcularSemaforo(liquido, c.piso ?? c.custo, c.custo);
  }));
}

/** Preview do pedido: aderir usa o preço sugerido (DEAL) ou o preço da oferta (SMART) e só marca o verde;
 *  sair usa o preço no ar e marca tudo — o cálculo do front é só orientação, o backend revalida. */
export function montarPreview(acao: AcaoPromocao, tipo: 'DEAL' | 'SMART', itens: ItemPromocao[]): LinhaPreview[] {
  return itens.map((it) => {
    const preco = acao === 'sair' ? it.preco_promo : tipo === 'DEAL' ? it.preco_sugerido : it.preco_promo;
    const semaforo = semaforoNoPreco(it.projecao, preco);
    return {
      ml_item_id: it.ml_item_id, titulo: it.titulo, preco, min: it.preco_min, max: it.preco_max,
      sugerido: it.preco_sugerido, ateQuanto: ateQuantoDaLinha(it).valor, semaforo,
      marcado: acao === 'sair' ? true : semaforo === 'verde',
    };
  });
}

/** Quantas linhas marcadas exigem o checkbox de risco confirmado (trava financeira do backend).
 *  Fix round 1 (achado 1): `sair` nunca exige — `validar.ts` não olha semáforo na saída (não cria
 *  prejuízo), então o checkbox de risco é só do `aderir`. */
export function precisaConfirmarRisco(acao: AcaoPromocao, linhas: LinhaPreview[]): { vermelho: number; indisponivel: number } {
  if (acao === 'sair') return { vermelho: 0, indisponivel: 0 };
  const marcadas = linhas.filter((l) => l.marcado);
  return {
    vermelho: marcadas.filter((l) => l.semaforo === 'vermelho').length,
    indisponivel: marcadas.filter((l) => l.semaforo === 'indisponivel').length,
  };
}

export const ROTULO_STATUS: Record<StatusItemOperacao, string> = {
  rascunho: 'Rascunho', pendente: 'Na fila', enviando: 'Enviando', conferindo: 'Conferindo no ML', aplicado: 'Feito', ja_estava: 'Já estava',
  mudou: 'Mudou desde o preview', bloqueado: 'Bloqueado', erro: 'Erro', saida_solicitada: 'Saída pedida',
};

// Overloads por família: o tipo de retorno é a família, não a mesma ação (inversa('pausar') é 'reativar').
export function inversa(a: AcaoPromocao): AcaoPromocao;
export function inversa(a: AcaoStatus): AcaoStatus;
/** Reverter de reajuste é outro reajuste (com `origem_id`), não uma ação oposta. */
export function inversa(a: 'reajustar'): 'reajustar';
export function inversa(a: AcaoOperacao): AcaoOperacao;
export function inversa(a: AcaoOperacao): AcaoOperacao {
  switch (a) {
    case 'aderir': return 'sair';
    case 'sair': return 'aderir';
    case 'pausar': return 'reativar';
    case 'reativar': return 'pausar';
    case 'reajustar': return 'reajustar';
  }
}

/** Ajuste 4: só `aderir` reverte também o que já estava participando; o resto só o que NÓS mudamos (`aplicado`). */
export function itensRevertiveis(acao: AcaoOperacao, itens: { ml_item_id: string; status: StatusItemOperacao }[]): string[] {
  const aceitos: StatusItemOperacao[] = acao === 'aderir' ? ['aplicado', 'ja_estava'] : ['aplicado'];
  return itens.filter((i) => aceitos.includes(i.status)).map((i) => i.ml_item_id);
}

export function tituloOperacao(
  op: { acao: string; promocao_nome: string | null; promocao_id: string | null; origem_id?: string | null }, total: number,
): string {
  const anuncios = `${total} anúncio${total === 1 ? '' : 's'}`;
  if (op.acao === 'reajustar') return op.origem_id ? `Reverter reajuste de ${anuncios}` : `Reajustar preço de ${anuncios}`;
  if (ehAcaoStatus(op.acao)) return `${op.acao === 'pausar' ? 'Pausar' : 'Reativar'} ${anuncios}`;
  const nome = op.promocao_nome ?? op.promocao_id ?? '';
  return `${op.acao === 'aderir' ? 'Aderir à' : 'Sair de'} ${nome}`;
}

export function motivoNaoSelecionavel(
  i: Pick<PublicadoItem, 'ehKitVirtual' | 'publicacaoIncompleta' | 'migracaoEmAndamento' | 'status'>,
): string | null {
  if (i.ehKitVirtual) return 'Kit Virtual não entra em pausar/reativar em massa';
  if (i.publicacaoIncompleta) return 'Publicação incompleta';
  if (i.migracaoEmAndamento) return 'Migração para preço por variação em andamento';
  if (i.status !== 'ativo' && i.status !== 'pausado') return 'Só anúncio ativo ou pausado';
  return null;
}

export function separarSelecao(itens: Pick<PublicadoItem, 'mlItemId' | 'status'>[]) {
  return {
    ativos: itens.filter((i) => i.status === 'ativo').map((i) => i.mlItemId),
    pausados: itens.filter((i) => i.status === 'pausado').map((i) => i.mlItemId),
  };
}
