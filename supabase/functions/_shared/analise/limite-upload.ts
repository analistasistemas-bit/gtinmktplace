// Guard de tamanho (achado F6, CLAUDE-SECURITY-20260822-113640): um payload base64 pequeno
// pode declarar um tamanho descomprimido arbitrário no header ZIP, fazendo o inflate vendorizado
// tentar alocar um buffer gigante antes de validar qualquer conteúdo real. Rejeitar o payload
// bruto acima de um teto pequeno ANTES de decodificar/parsear limita o dano — mesmo sem checar a
// razão de compressão (fora de escopo: exigiria tocar o inflate vendorizado).
export const MAX_ARQUIVO_BASE64_CHARS = 8 * 1024 * 1024; // ~8MB de texto base64 (~6MB decodificado)

export function excedeLimiteBase64(base64: string, limiteChars = MAX_ARQUIVO_BASE64_CHARS): boolean {
  return base64.length > limiteChars;
}
