// Aviso aberto de versão nova só na 1ª vez do dia, por aparelho (ADR-0153 D4, emenda 2026-11-15).
// localStorage pode lançar (aba anônima, dados bloqueados): sem storage, trata como já avisado,
// para nunca voltar ao aviso insistente.
const CHAVE = 'publiai:aviso-versao-dia';
// Cópia em memória: cobre storage que lê mas não grava (Safari anônimo), sem reabrir a cada remount.
let avisadoEmMemoria: string | null = null;

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function jaAvisouHoje(): boolean {
  if (avisadoEmMemoria === hoje()) return true;
  try {
    return localStorage.getItem(CHAVE) === hoje();
  } catch {
    return true;
  }
}

export function marcarAvisadoHoje(): void {
  try {
    localStorage.setItem(CHAVE, hoje());
  } catch {
    avisadoEmMemoria = hoje(); // vale até recarregar a página
  }
}
