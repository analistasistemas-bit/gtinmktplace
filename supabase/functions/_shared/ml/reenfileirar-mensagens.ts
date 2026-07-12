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
