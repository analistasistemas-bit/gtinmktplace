// Predicados de "precisa reprocessar?" do reconciliar-faturamento (rede de segurança horária).
//
// POR QUE EXISTEM: o reconciliar re-upsertava TODA pergunta e TODO claim do vendedor a cada hora,
// mesmo sem mudança alguma. Medido em 2026-08-17: 87 das 88 perguntas ANSWERED e imutáveis, e 67
// dos 88 claims fechados há mais de 7 dias — ~19 mil requisições PostgREST/dia só para regravar
// dado idêntico, ~10 MB/dia de egress (o projeto estourou a cota de 5 GB do plano Free).
//
// POR QUE AQUI E NÃO DENTRO DE upsertPergunta/upsertDevolucao: essas funções também servem o
// caminho de webhook (sync-pergunta, sync-devolucao), que dispara JUSTAMENTE porque algo mudou.
// Um predicado de pulo lá dentro suprimiria atualização real. O filtro é do CHAMADOR periódico.
//
// Puros de propósito: `reconciliar-faturamento/index.ts` é entrypoint Deno (`Deno.serve`) e não é
// importável pelo vitest; a decisão precisa morar em módulo testável.

/** Colunas de `ml_perguntas` que o predicado compara. */
export interface PerguntaLocal {
  status: string | null;
  resposta: string | null;
  item_titulo: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
}

/** Campos de `mapearPergunta(q)` usados na comparação. */
export interface PerguntaComparavel {
  status: string;
  resposta: string | null;
  comprador_id: number | null;
}

/**
 * A pergunta precisa de upsert? Falso só quando o estado gravado já é idêntico ao do ML.
 * Pergunta respondida no ML é imutável — é o caso da esmagadora maioria.
 */
export function perguntaPrecisaUpsert(
  row: PerguntaComparavel,
  itemTitulo: string | null,
  local: PerguntaLocal | undefined,
): boolean {
  if (!local) return true; // nunca vista
  if (local.status !== row.status) return true;
  if (local.resposta !== row.resposta) return true;
  // Título só conta quando veio de fato: `buscarTituloItem` devolve null em erro, e tratar isso
  // como "mudou" faria o upsert gravar item_titulo = null, APAGANDO o título bom por causa de uma
  // falha transitória do ML. Pular é o lado seguro.
  if (itemTitulo != null && local.item_titulo !== itemTitulo) return true;
  // O nick só sai de GET /users/{id} (o ML v4 parou de mandá-lo em /questions) e o reconciliar é
  // quem faz esse backfill. Enquanto faltar e houver de quem buscar, processa.
  if (local.comprador_nick == null && (row.comprador_id ?? local.comprador_id) != null) return true;
  return false;
}

/** Colunas de `ml_devolucoes` que o predicado compara. */
export interface DevolucaoLocal {
  status: string | null;
  stage: string | null;
  aberto_em: string | null;
  fechado_em: string | null;
  return_status_money: string | null;
}

/** Estados em que o dinheiro do return já parou de se mexer. */
const DINHEIRO_FINAL = new Set(['refunded', 'retained', 'not_refunded']);

/** Graça após o fechamento em que o claim ainda é reprocessado, porque `return_status_money` pode
 *  mudar depois de o claim fechar e essa mudança é INVISÍVEL no payload do claim. */
export const GRACA_CLAIM_DIAS = 7;

/**
 * O claim precisa ser reprocessado? Reprocessar custa caro: buscarReturn + upsertDevolucao +
 * buscarPedido + upsertVenda completo (~8 requisições REST). Um claim fechado há semanas, com o
 * dinheiro resolvido e o mesmo status/stage do ML, não tem o que atualizar.
 */
export function claimPrecisaProcessar(
  claim: { status?: string | null; stage?: string | null },
  local: DevolucaoLocal | undefined,
  agoraMs: number,
  gracaDias: number = GRACA_CLAIM_DIAS,
): boolean {
  if (!local) return true; // claim novo
  const status = claim.status ?? null;
  if (status !== local.status) return true;
  if ((claim.stage ?? null) !== local.stage) return true;
  if (status === 'opened') return true; // em curso: sempre
  // return_status/return_status_money vêm de GET /returns, não do payload do claim — mudança ali
  // é invisível para as comparações acima. Enquanto o dinheiro não estiver em estado final,
  // reprocessa incondicionalmente.
  if (local.return_status_money != null && !DINHEIRO_FINAL.has(local.return_status_money)) return true;
  const referencia = Date.parse(local.fechado_em ?? local.aberto_em ?? '');
  if (!Number.isFinite(referencia)) return true; // sem data confiável: não arrisca
  return agoraMs - referencia < gracaDias * 24 * 60 * 60 * 1000;
}
