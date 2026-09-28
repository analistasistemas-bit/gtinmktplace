// ADR-0173: um lote do reconciliar agendado por org, retomável pelo cursor:
// pendencias → perguntas → claims → vendas (72h) → liberacoes (120 d do MP) → fim.
// Puro — só `import type` e módulos puros —, testável por vitest. Fiação real em index.ts.
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import type { PedidoML } from '../_shared/faturamento/venda.ts';
import type { ClaimML } from '../_shared/faturamento/devolucao.ts';
import { LOTE_PENDENCIAS } from '../_shared/faturamento/pendencias.ts';
import { chunk } from '../_shared/faturamento/utils.ts';
import { gravarCursor, lerCursor, type Acumulado, type Passo, type ResultadoPasso } from '../_shared/rodada/rodada.ts';

export interface ParamsReconciliar extends Record<string, unknown> { desde: string; ate: string; hojeBRT: string }
export const LOTE_CLAIMS = 10;     // cada claim custa ~8 requisições (return + devolução + pedido + venda inteira)
export const LOTE_PEDIDOS = 25;
const PARALELAS = 5;               // mesmo grau do laço legado

export interface DepsReconciliar {
  conexao(): Promise<{ cx: ConexaoCanal; userId: string | null } | null>;
  /** Token + registrarSyncOk; auth permanente → registrarFalhaAuth + notificação 'integracao' se
   *  !jaAlertado e lança SemAcessoRodada. Chamado em TODA etapa. */
  token(cx: ConexaoCanal): Promise<string>;
  perguntas(token: string, userId: string, orgId: string): Promise<number>;
  /** buscarClaimsSeller + carregarDevolucoesLocais + claimPrecisaProcessar: os OBJETOS pendentes. */
  claimsPendentes(token: string, userId: string): Promise<ClaimML[]>;
  /** Nunca lança por claim. */
  processarClaims(token: string, cx: ConexaoCanal, userId: string, orgId: string, claims: ClaimML[]): Promise<number>;
  pedidosDaJanela(token: string, janela: { desde: string; ate: string }): Promise<PedidoML[]>;
  pedidoPorId(token: string, id: string): Promise<PedidoML>;
  pendencias(depoisDe: string, limite: number): Promise<string[]>;
  /** `inicio` = ISO capturado ANTES de processar o lote (a tentativa). Devolve descartados. */
  registrarPendencias(ok: string[], inicio: string, falhas: string[], erro: string | null): Promise<number>;
  pendentesAtivos(): Promise<number>;
  agora(): string;
  /** Upsert + tratarPedidoCancelado, MP por pedido; desfecho de cada um por `desfechoPedido`. Nunca lança por pedido. */
  processarPedidos(token: string, cx: ConexaoCanal, userId: string, orgId: string, pedidos: PedidoML[]): Promise<ResultadoPedidos>;
  /** carregarLiquidoMP (120 d) + reconciliarLiberacoes. MP null → loga e devolve 0. */
  liberacoes(token: string, cx: ConexaoCanal, orgId: string, hojeBRT: string): Promise<number>;
}

export interface ResultadoPedidos { ok: string[]; falhas: string[]; mpFalhou: string[] }
export const resultadoVazio = (): ResultadoPedidos => ({ ok: [], falhas: [], mpFalhou: [] });

/** Classifica UM pedido. `trabalho` devolve se o MP foi lido (false = `carregarLiquidoMPDoPedido`
 *  null). Lança → `falhas` (soma tentativa). MP não lido → NEM `ok` NEM `falhas`: `ok` apagaria a
 *  pendência (única re-tentativa do estorno de pedido fora da janela) e `falhas` descartaria a
 *  venda após 5 leituras ruins do MP; a pendência fica como está. Devolve o erro, se houve, p/ log. */
export async function desfechoPedido(r: ResultadoPedidos, id: string, trabalho: () => Promise<boolean>): Promise<unknown> {
  try {
    (await trabalho() ? r.ok : r.mpFalhou).push(id);
    return null;
  } catch (e) {
    r.falhas.push(id);
    return e;
  }
}

const somar = (a: Acumulado, k: string, n: number): Acumulado => ({ ...a, [k]: (a[k] ?? 0) + n });

function posNumerica(etapa: string, pos: string): number {
  const n = Number(pos); // '' → 0
  // NaN pularia a etapa inteira em silêncio (nenhum id > NaN).
  if (Number.isNaN(n)) throw new Error(`reconciliar: cursor de ${etapa} inválido: ${etapa}|${pos}`);
  return n;
}

export function passoReconciliar(deps: DepsReconciliar, orgId: string): Passo<ParamsReconciliar> {
  /** Grava o resultado da tentativa: `ok` apaga pendência registrada ANTES de `inicio`; `falhas` entram/incrementam. */
  async function registrar(acc: Acumulado, r: ResultadoPedidos, inicio: string): Promise<Acumulado> {
    const { ok, falhas } = r;
    const erro = falhas.length ? `reconciliar: ${falhas.length} pedido(s) falharam no lote` : null;
    const descartados = await deps.registrarPendencias(ok, inicio, falhas, erro);
    // MP não lido: fora das duas listas; a pendência que houver continua e o fim sai `parcial`.
    acc = somar(acc, 'mpFalhou', r.mpFalhou.length);
    acc = somar(acc, 'reconciliados', ok.length);
    acc = somar(acc, 'pedidosComFalha', falhas.length);
    return somar(acc, 'pedidosDescartados', descartados);
  }

  return async ({ cursor, acumulado, params }) => {
    const conexao = await deps.conexao();
    // Conexão sem dono é estado estrutural (o legado pula), não falha.
    if (!conexao || !conexao.userId) return { proximo: null, acumulado };
    const { cx, userId } = conexao;
    const token = await deps.token(cx);
    const c = lerCursor(cursor) ?? { etapa: 'pendencias', pos: '' };
    const ir = (etapa: string, pos = '') => gravarCursor({ etapa, pos });

    if (c.etapa === 'pendencias') {
      // Antes de ler: sucesso só apaga falha registrada antes desta tentativa começar.
      const inicio = deps.agora();
      // Ordem de TEXTO de order_id (lerPendencias), então o cursor é o último do array como veio.
      const ids = await deps.pendencias(c.pos, LOTE_PENDENCIAS);
      if (ids.length === 0) return { proximo: ir('perguntas'), acumulado };
      const lidos: PedidoML[] = [];
      const falhasLeitura: string[] = [];
      for (const lote of chunk(ids, PARALELAS)) {
        const rs = await Promise.allSettled(lote.map((id) => deps.pedidoPorId(token, id)));
        rs.forEach((r, i) => {
          if (r.status === 'fulfilled') lidos.push(r.value);
          else { falhasLeitura.push(lote[i]); console.warn(`reconciliar: pendência ${lote[i]} da org ${orgId} não leu o pedido: ${(r.reason as Error)?.message ?? r.reason}`); }
        });
      }
      const r = lidos.length ? await deps.processarPedidos(token, cx, userId, orgId, lidos) : resultadoVazio();
      const acc = await registrar(acumulado, { ...r, falhas: [...falhasLeitura, ...r.falhas] }, inicio);
      const proximo = ids.length === LOTE_PENDENCIAS ? ir('pendencias', ids[ids.length - 1]) : ir('perguntas');
      return { proximo, acumulado: acc };
    }

    if (c.etapa === 'perguntas') {
      const n = await deps.perguntas(token, userId, orgId);
      return { proximo: ir('claims'), acumulado: somar(acumulado, 'perguntas', n) };
    }

    if (c.etapa === 'claims') {
      const desde = posNumerica('claims', c.pos);
      const lote = (await deps.claimsPendentes(token, userId))
        .filter((cl) => Number(cl.id) > desde)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, LOTE_CLAIMS);
      if (lote.length === 0) return { proximo: ir('vendas'), acumulado };
      const n = await deps.processarClaims(token, cx, userId, orgId, lote);
      return { proximo: ir('claims', String(lote[lote.length - 1].id)), acumulado: somar(acumulado, 'claims', n) };
    }

    if (c.etapa === 'vendas') {
      const desde = posNumerica('vendas', c.pos);
      const inicio = deps.agora();
      const lote = (await deps.pedidosDaJanela(token, { desde: params.desde, ate: params.ate }))
        .filter((p) => Number(p.id) > desde)
        .sort((a, b) => Number(a.id) - Number(b.id))
        .slice(0, LOTE_PEDIDOS);
      if (lote.length === 0) return { proximo: ir('liberacoes'), acumulado };
      const r = await deps.processarPedidos(token, cx, userId, orgId, lote);
      // Sempre, mesmo sem falha: o `ok` limpa pendência anterior do mesmo pedido.
      const acc = await registrar(acumulado, r, inicio);
      return { proximo: ir('vendas', String(lote[lote.length - 1].id)), acumulado: acc };
    }

    if (c.etapa === 'liberacoes') {
      const n = await deps.liberacoes(token, cx, orgId, params.hojeBRT);
      return fim(somar(acumulado, 'liberacoesCorrigidas', n), await deps.pendentesAtivos());
    }

    throw new Error(`reconciliar: etapa desconhecida no cursor: ${cursor}`);
  };
}

function fim(acumulado: Acumulado, pendentes: number): ResultadoPasso {
  const descartados = acumulado.pedidosDescartados ?? 0;
  const parcial = pendentes > 0
    ? `${pendentes} pedido(s) pendente(s)`
    : descartados > 0 ? `${descartados} pedido(s) descartado(s) após 5 tentativas` : null;
  return { proximo: null, acumulado, parcial };
}
