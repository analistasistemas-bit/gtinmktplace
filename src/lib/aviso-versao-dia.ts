// Aviso aberto de versão nova só na 1ª vez do dia, por aparelho (ADR-0153 D4, emenda 2026-11-15).
// localStorage pode lançar (aba anônima, dados bloqueados): sem storage, trata como já avisado,
// para nunca voltar ao aviso insistente.
const CHAVE = 'publiai:aviso-versao-dia';

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function jaAvisouHoje(): boolean {
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
    // ponytail: sem storage o aviso já é tratado como dado (jaAvisouHoje → true).
  }
}
