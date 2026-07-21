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

// Classifica o resultado do INSERT da linha de dedup do webhook. SÓ `23505` (unique_violation)
// significa "já recebido"; qualquer outro erro do INSERT (RLS/timeout/pool) NÃO é duplicado — o
// evento é novo e não pode ser engolido (vendas têm backstop de 72h, mas perguntas/devoluções
// não). Duplicado real de topic ≠ `messages` → ignora; `messages` precisa da checagem temporal.
export function classificarDedupWebhook(
  dupErr: { code?: string } | null,
  topic: string,
): AcaoDedupWebhook {
  if (!dupErr) return 'enfileirar'; // INSERT ok: evento novo.
  if (dupErr.code !== '23505') return 'enfileirar'; // erro não-duplicado: não engole.
  return topic === 'messages' ? 'checar-messages' : 'ignorar'; // duplicado real.
}
