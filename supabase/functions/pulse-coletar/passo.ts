// ADR-0173: um lote do Pulse agendado por org (radar → produtos), retomável pelo cursor.
// Puro — só `import type` —, testável por vitest. Fiação real em index.ts (`depsPulseReal`).
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import {
  SemAcessoRodada, gravarCursor, lerCursor, type Acumulado, type Passo, type ResultadoPasso,
} from '../_shared/rodada/rodada.ts';
import { elegivelPorBackoff, type ContextoColeta, type ProdutoColeta, type ResultadoLote } from './processar.ts';

export interface ParamsPulse extends Record<string, unknown> { tier: 'completo' | 'quente' }

export const LOTE_COMPLETO = 20;
export const LOTE_QUENTE = 40;
// Janela de LEITURA por mensagem — maior que o lote processado: dá margem para pular produtos em
// backoff sem precisar de mais uma viagem ao banco só para achar quem é elegível.
export const JANELA_LEITURA = 100;

export interface DepsPulse {
  conexao(): Promise<ConexaoCanal | null>;
  /** Auth permanente → SemAcessoRodada (classificação fica em depsPulseReal, real). */
  contexto(cx: ConexaoCanal): Promise<ContextoColeta>;
  sincronizarRadar(): Promise<void>;
  /** Ativos, id > depoisDe, ordenados por id; tier quente só traz origem='auto'. */
  produtos(depoisDe: string, limite: number, tier: 'completo' | 'quente'): Promise<ProdutoColeta[]>;
  processarLote(ctx: ContextoColeta, produtos: ProdutoColeta[], tier: 'completo' | 'quente', baseline: boolean): Promise<ResultadoLote>;
  agora(): number;
}

const somar = (a: Acumulado, k: string, n: number): Acumulado => ({ ...a, [k]: (a[k] ?? 0) + n });

async function etapaProdutos(
  deps: DepsPulse, cx: ConexaoCanal, tier: 'completo' | 'quente', pos: string, acumuladoEntrada: Acumulado,
): Promise<ResultadoPasso> {
  // ctx é buscado sempre — mesmo que a janela lida não tenha nenhum elegível — porque
  // `naoClassificavel` viaja no acumulado a cada lote realmente processado, e o custo (token +
  // 1 leitura) é o mesmo que qualquer outra mensagem da rodada.
  const ctx = await deps.contexto(cx);
  const lidos = await deps.produtos(pos, JANELA_LEITURA, tier);
  if (lidos.length === 0) return { proximo: null, acumulado: acumuladoEntrada };

  const LOTE = tier === 'completo' ? LOTE_COMPLETO : LOTE_QUENTE;
  const agoraMs = deps.agora();
  const elegiveis: ProdutoColeta[] = [];
  // O cursor nunca passa de item não examinado: `ultimoExaminado` só avança junto com o loop.
  let ultimoExaminado = pos;
  for (const p of lidos) {
    ultimoExaminado = p.id;
    if (elegivelPorBackoff(p, agoraMs, tier)) elegiveis.push(p);
    if (elegiveis.length >= LOTE) break; // lote completo — para de examinar a janela
  }

  let acumulado = acumuladoEntrada;
  if (elegiveis.length > 0) {
    const r = await deps.processarLote(ctx, elegiveis, tier, tier === 'completo');
    acumulado = somar(acumulado, 'produtos', r.produtos);
    acumulado = somar(acumulado, 'gravadas', r.gravadas);
    acumulado = somar(acumulado, 'alertas', r.alertas);
    acumulado = somar(acumulado, 'acao', r.acao);
    acumulado = { ...acumulado, naoClassificavel: Math.max(acumulado.naoClassificavel ?? 0, ctx.naoClassificavel ? 1 : 0) };
  }
  return { proximo: gravarCursor({ etapa: 'produtos', pos: ultimoExaminado }), acumulado };
}

export function passoPulse(deps: DepsPulse): Passo<ParamsPulse> {
  return async ({ cursor, acumulado, params }) => {
    const cx = await deps.conexao();
    if (!cx) throw new SemAcessoRodada('pulse: sem conexão ML');

    if (cursor === null) {
      if (params.tier === 'completo') {
        await deps.sincronizarRadar();
        return { proximo: gravarCursor({ etapa: 'produtos', pos: '' }), acumulado };
      }
      return etapaProdutos(deps, cx, params.tier, '', acumulado);
    }

    const c = lerCursor(cursor)!;
    if (c.etapa !== 'produtos') throw new Error(`pulse: etapa desconhecida no cursor: ${cursor}`);
    return etapaProdutos(deps, cx, params.tier, c.pos, acumulado);
  };
}

/** `acumulado.alertas` > 0 → há decisão de preço pendente nesta rodada, vale notificar. */
export const precisaNotificarPulse = (a: Acumulado): boolean => (a.alertas ?? 0) > 0;

/** Chave de idempotência da notificação in-app: uma por (job, org, ciclo) — não por cada lote. */
export const chaveNotificacaoPulse = (job: string, orgId: string, ciclo: string): string =>
  `pulse:${job}:${orgId}:${ciclo}`;
