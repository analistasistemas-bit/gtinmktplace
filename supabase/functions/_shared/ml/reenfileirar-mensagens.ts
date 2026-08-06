// Decide se um evento `messages` em conflito de dedup deve ser reenfileirado mesmo assim
// (plan 035): a linha de dedup de uma conversa fica até o worker processá-la (ver
// sync-mensagem/index.ts), então uma mensagem que chega ENQUANTO o sync do pack roda esbarra
// numa linha "viva" e é dropada. Se essa linha for antiga e nunca processada, é sinal de job
// perdido — vale reenfileirar.
export function deveReenfileirarMensagens(
  existente: { recebido_em: string; processado_em: string | null } | null,
  agoraMs: number,
): boolean {
  if (!existente || existente.processado_em) return false;
  return agoraMs - new Date(existente.recebido_em).getTime() > 120_000;
}

export type AcaoDedupWebhook = 'enfileirar' | 'ignorar' | 'checar-messages';

// Tópicos cujo `resource` é o MESMO em toda a vida do recurso, então o 2º evento nunca é uma
// repetição: é mudança de estado. `questions` = pergunta criada → respondida (o ML notifica os
// dois); `claims` = opened → in_mediation → closed. Dedup por (topic, resource) descartava essas
// transições, e nenhum dos dois tem backstop — a resposta dada no ML só voltava na reconciliação
// horária. O worker é idempotente e o throttle acima já cobre flood forjado, então reenfileirar
// custa 1 job a mais por transição.
const REPROCESSA_NO_DUPLICADO = new Set(['questions', 'claims']);

// Classifica o resultado do INSERT da linha de dedup do webhook. SÓ `23505` (unique_violation)
// significa "já recebido"; qualquer outro erro do INSERT (RLS/timeout/pool) NÃO é duplicado — o
// evento é novo e não pode ser engolido. Duplicado real: `messages` precisa da checagem temporal,
// `questions`/`claims` reenfileiram sempre, o resto (vendas/envios, com backstop de 72h) ignora.
export function classificarDedupWebhook(
  dupErr: { code?: string } | null,
  topic: string,
): AcaoDedupWebhook {
  if (!dupErr) return 'enfileirar'; // INSERT ok: evento novo.
  if (dupErr.code !== '23505') return 'enfileirar'; // erro não-duplicado: não engole.
  if (topic === 'messages') return 'checar-messages';
  return REPROCESSA_NO_DUPLICADO.has(topic) ? 'enfileirar' : 'ignorar';
}
