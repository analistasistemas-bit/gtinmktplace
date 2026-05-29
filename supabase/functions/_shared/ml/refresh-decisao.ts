/** true se o token expira dentro de `bufferMs` (ou já expirou). */
export function precisaRenovar(
  expiresAtMs: number,
  agoraMs: number,
  bufferMs: number,
): boolean {
  return expiresAtMs - agoraMs <= bufferMs;
}
