// ADR-0173: um lote do backfill agendado por org (vendas → mensagens), retomável pelo cursor.
// Puro — só `import type` —, testável por vitest. Fiação real em index.ts (`depsBackfillReal`).
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import type { PackVenda } from '../_shared/faturamento/mensagens-io.ts';
import { cicloDiaBrt, gravarCursor, lerCursor, type Acumulado, type Job, type Passo, type ResultadoPasso } from '../_shared/rodada/rodada.ts';

export interface ParamsBackfill extends Record<string, unknown> { desde: string; ate: string }
export const LOTE_PEDIDOS = 20;
export const LOTE_PACKS = 40;

export interface DepsBackfill {
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Auth permanente (classificarErroML === 'permanente-auth') → registrarFalhaAuth e lança SemAcessoRodada. */
  token(cx: ConexaoCanal): Promise<string>;
  pedidosDaJanela(token: string, janela: ParamsBackfill): Promise<PedidoML[]>;
  /** Por pedido: frete, shipment, carregarLiquidoMPDoPedido, GTIN fallback, upsertVenda. Nunca lança por pedido. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, pedidos: PedidoML[]): Promise<{ ok: string[]; falhas: string[]; mpFalhou: boolean }>;
  /** Só REGISTRA falhas (ok=[]): quem retoma e apaga pendência é o reconciliar, que tem o escopo completo
   *  (inclui tratarPedidoCancelado) e é serializado por org pela posse. */
  registrarFalhas(falhas: string[], erro: string): Promise<number>;
  packs(userId: string): Promise<PackVenda[]>;
  /** Lança na 1ª falha transitória. */
  processarPacks(token: string, userId: string, orgId: string, contaExternaId: string, packs: PackVenda[]): Promise<number>;
}

const somar = (a: Acumulado, k: string, n: number): Acumulado => ({ ...a, [k]: (a[k] ?? 0) + n });

function fim(acumulado: Acumulado): ResultadoPasso {
  const falhas = acumulado.pedidosComFalha ?? 0;
  // Descartado continua em worker_pendencias com descartado_em (recuperável limpando a coluna).
  return { proximo: null, acumulado, parcial: falhas > 0 ? `${falhas} pedido(s) com falha, registrados para o reconciliar` : null };
}

export function passoBackfill(deps: DepsBackfill, orgId: string): Passo<ParamsBackfill> {
  return async ({ cursor, acumulado, params }) => {
    const conexao = await deps.conexao();
    // Conexão sem dono é estado estrutural (como SEM_NADA no caminho legado), não falha.
    if (!conexao || !conexao.userId) return fim(acumulado);
    const { cx, userId } = conexao;
    const token = await deps.token(cx);
    const c = lerCursor(cursor) ?? { etapa: 'vendas', pos: '' };

    if (c.etapa === 'vendas') {
      const desde = Number(c.pos); // '' → 0
      // NaN pularia a etapa inteira em silêncio (nenhum id > NaN).
      if (Number.isNaN(desde)) throw new Error(`backfill: cursor de vendas inválido: ${cursor}`);
      const lote = (await deps.pedidosDaJanela(token, params))
        .filter((p) => Number(p.id) > desde)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, LOTE_PEDIDOS);
      if (lote.length === 0) return { proximo: gravarCursor({ etapa: 'mensagens', pos: '' }), acumulado };
      const r = await deps.processarPedidos(token, cx, userId, lote);
      let acc = somar(acumulado, 'sincronizados', r.ok.length);
      acc = somar(acc, 'pedidosComFalha', r.falhas.length);
      acc = { ...acc, mpFalhou: Math.max(acc.mpFalhou ?? 0, r.mpFalhou ? 1 : 0) };
      if (r.falhas.length) {
        const descartados = await deps.registrarFalhas(r.falhas, `backfill: ${r.falhas.length} pedido(s) falharam no lote`);
        acc = somar(acc, 'pedidosDescartados', descartados);
      }
      return { proximo: gravarCursor({ etapa: 'vendas', pos: String(lote[lote.length - 1].id) }), acumulado: acc };
    }

    if (c.etapa === 'mensagens') {
      // Perguntas e claims NÃO são relidas no caminho agendado (releem o histórico inteiro do vendedor).
      if (!cx.contaExternaId) return fim(acumulado);
      const lote = (await deps.packs(userId))
        .filter((p) => p.packId.localeCompare(c.pos) > 0)
        .sort((a, b) => a.packId.localeCompare(b.packId))
        .slice(0, LOTE_PACKS);
      if (lote.length === 0) return fim(acumulado);
      const n = await deps.processarPacks(token, userId, orgId, cx.contaExternaId, lote);
      return { proximo: gravarCursor({ etapa: 'mensagens', pos: lote[lote.length - 1].packId }), acumulado: somar(acumulado, 'packs', n) };
    }

    throw new Error(`backfill: etapa desconhecida no cursor: ${cursor}`);
  };
}

/** Identidade do disparo. Diário: dia BRT. Recuperação: a própria janela do body (`desde_ate`, ISO
 *  completos) — um retry do disparador gera o MESMO ciclo; recuperações diferentes, ciclos diferentes.
 *  Ordem textual entre recuperações = ordem de `desde`, o que só importa para rejeitar mensagem de uma
 *  recuperação anterior chegando depois de outra (vira `obsoleta`; as pendências ficam na org).
 *  Body com só um dos dois é rejeitado ANTES, no handler (400). */
export function cicloDoDisparo(body: { desde?: string; ate?: string }, agora: Date): { job: Job; ciclo: string } {
  if (body.desde && body.ate) return { job: 'backfill-recuperacao', ciclo: `${body.desde}_${body.ate}` };
  return { job: 'backfill', ciclo: cicloDiaBrt(agora) };
}
