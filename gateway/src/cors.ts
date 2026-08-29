// CORS do Gateway.
//
// A D-2 da ADR-0132 manda o BROWSER chamar o Gateway direto, sem Edge Function intermediando.
// Isso torna o CORS parte da superfície de segurança, não detalhe de conveniência: a origem
// precisa de allowlist explícita.
//
// `*` é proibido aqui. O Gateway responde com dado por organização e aceita `Authorization`;
// origem curinga somada a credenciais é exatamente o que o navegador tenta impedir.

export function origemPermitida(origem: string | undefined, permitidas: string[]): string | null {
  if (!origem) return null
  return permitidas.includes(origem) ? origem : null
}

export function cabecalhosCors(origem: string | null): Record<string, string> {
  if (!origem) return {}
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    // Sem esta linha um proxy pode servir a uma origem a resposta liberada para outra.
    Vary: 'Origin',
    'Access-Control-Max-Age': '600',
  }
}

/** Lê a allowlist da env: origens separadas por vírgula. Vazio = nenhuma origem liberada. */
export function origensDaEnv(valor: string | undefined): string[] {
  return (valor ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
}
