// ADR-0174 — operações em massa (aderir/sair de promoções DEAL/SMART do ML): regras puras do front.
import { calcularSemaforo, type Semaforo } from '@/lib/semaforo';
import { ateQuantoDaLinha, type CorProjetada, type ItemPromocao } from '@/lib/promocoes';

export type AcaoOperacao = 'aderir' | 'sair';
export type StatusItemOperacao =
  | 'pendente' | 'enviando' | 'aplicado' | 'ja_estava' | 'mudou' | 'bloqueado' | 'erro' | 'saida_solicitada';

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
  return piorSemaforo(projecao.map((c) => {
    if (c.comissao_pct == null || c.frete == null || c.aliquota_pct == null || c.custo == null) return 'indisponivel';
    const liquido = liquidoNoPreco(preco, c.comissao_pct, c.comissao_fixa ?? 0, c.frete, c.aliquota_pct);
    return calcularSemaforo(liquido, c.piso ?? c.custo, c.custo);
  }));
}

/** Preview do pedido: aderir usa o preço sugerido (DEAL) ou o preço da oferta (SMART) e só marca o verde;
 *  sair usa o preço no ar e marca tudo — o cálculo do front é só orientação, o backend revalida. */
export function montarPreview(acao: AcaoOperacao, tipo: 'DEAL' | 'SMART', itens: ItemPromocao[]): LinhaPreview[] {
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

/** Quantas linhas marcadas exigem o checkbox de risco confirmado (trava financeira do backend). */
export function precisaConfirmarRisco(linhas: LinhaPreview[]): { vermelho: number; indisponivel: number } {
  const marcadas = linhas.filter((l) => l.marcado);
  return {
    vermelho: marcadas.filter((l) => l.semaforo === 'vermelho').length,
    indisponivel: marcadas.filter((l) => l.semaforo === 'indisponivel').length,
  };
}

export const ROTULO_STATUS: Record<StatusItemOperacao, string> = {
  pendente: 'Na fila', enviando: 'Enviando', aplicado: 'Feito', ja_estava: 'Já estava',
  mudou: 'Mudou desde o preview', bloqueado: 'Bloqueado', erro: 'Erro', saida_solicitada: 'Saída pedida',
};

export function inversa(a: AcaoOperacao): AcaoOperacao {
  return a === 'aderir' ? 'sair' : 'aderir';
}

/** Ajuste 4: `sair` só reverte item que saiu de fato (`aplicado`); `aderir` reverte tanto o que entrou
 *  (`aplicado`) quanto o que já estava participando (`ja_estava`). */
export function itensRevertiveis(
  acao: AcaoOperacao, itens: { ml_item_id: string; status: StatusItemOperacao }[],
): string[] {
  const aceitos: StatusItemOperacao[] = acao === 'sair' ? ['aplicado'] : ['aplicado', 'ja_estava'];
  return itens.filter((i) => aceitos.includes(i.status)).map((i) => i.ml_item_id);
}
