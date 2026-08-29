// Log de acesso do Gateway (ADR-0132 D-16).
//
// Nasceu de uma pergunta concreta que não dava para responder: **o servidor de autorização da
// JoomPulse chegou a buscar nosso documento de cliente?** Sem log de requisição, a única resposta
// possível era "não sei".
//
// A D-16 já exigia observabilidade sem tokens. Este arquivo é a forma mínima disso.
//
// REGRA: a query string NUNCA é registrada. Ela carrega `code`, `state` e, num redirect de erro do
// provedor, pedaços de credencial. Só o caminho entra. O `user-agent` entra porque é justamente
// ele que distingue "o provedor buscou o documento" de "alguém abriu no browser".

export interface EventoAcesso {
  metodo: string
  caminho: string
  status: number
  duracaoMs: number
  agente: string | null
}

/** Recorta o user-agent: o suficiente para identificar quem chamou, sem encher o log. */
export function resumirAgente(ua: string | undefined): string | null {
  if (!ua) return null
  return ua.length > 80 ? `${ua.slice(0, 80)}…` : ua
}

export function formatarAcesso(e: EventoAcesso): string {
  const agente = e.agente ? ` ua="${e.agente}"` : ''
  return `[gateway] ${e.metodo} ${e.caminho} ${e.status} ${e.duracaoMs}ms${agente}`
}
