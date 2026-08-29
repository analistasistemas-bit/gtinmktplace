// Client ID Metadata Document (ADR-0132 Errata 3).
//
// O metadado da JoomPulse declara `client_id_metadata_document_supported: true` e **não** anuncia
// `registration_endpoint`. Ou seja: não há registro dinâmico, mas o `client_id` PODE ser uma URL
// HTTPS que serve um documento descrevendo o próprio cliente.
//
// Isso remove a dependência de a JoomPulse emitir um identificador: o Gateway publica o documento
// e o endereço dele vira o `client_id`.
//
// Regra central da especificação: o `client_id` DENTRO do documento tem de ser idêntico à URL de
// onde ele foi servido. Documento que se declara com outro id é rejeitado pelo servidor de
// autorização — e é por isso que existe a checagem de coerência aqui, feita no boot.

/** Caminho onde o Gateway publica o documento. É o sufixo que um client_id CIMD precisa ter. */
export const CAMINHO_CIMD = '/v1/client-metadata.json'

export interface ConfigCimd {
  clientId: string
  redirectUri: string
  /** Presente = client confidencial; ausente = público, com o PKCE segurando a proteção. */
  temSecret: boolean
  nomeCliente?: string
  uriApp?: string
}

export interface DocumentoCimd {
  client_id: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  scope: string
  token_endpoint_auth_method: string
  client_uri?: string
}

/** `client_id` em forma de URL https é a assinatura do modo CIMD. */
export function ehCimd(clientId: string): boolean {
  return clientId.startsWith('https://')
}

/**
 * O documento só é aceito se for servido exatamente na URL do `client_id`. Como o Gateway publica
 * num caminho fixo, um client_id CIMD que aponte para outro lugar está errado — e falhar no boot
 * é muito melhor que descobrir isso no meio de uma conexão de cliente.
 */
export function cimdCoerente(clientId: string): boolean {
  if (!ehCimd(clientId)) return true // id opaco registrado: nada a conferir
  try {
    return new URL(clientId).pathname === CAMINHO_CIMD
  } catch {
    return false
  }
}

export function documentoCimd(cfg: ConfigCimd): DocumentoCimd {
  const doc: DocumentoCimd = {
    // Idêntico à URL de publicação — exigência da especificação.
    client_id: cfg.clientId,
    client_name: cfg.nomeCliente ?? 'PubliAI — Análise PubliAI',
    // Uma só: o redirect é fixo por ambiente e ampliar a lista amplia a superfície de ataque.
    redirect_uris: [cfg.redirectUri],
    // Exatamente os grants que a JoomPulse anuncia suportar.
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp',
    // Sem secret o provedor aceita `none`, e o PKCE S256 continua protegendo o code.
    token_endpoint_auth_method: cfg.temSecret ? 'client_secret_basic' : 'none',
  }
  if (cfg.uriApp) doc.client_uri = cfg.uriApp
  return doc
}
