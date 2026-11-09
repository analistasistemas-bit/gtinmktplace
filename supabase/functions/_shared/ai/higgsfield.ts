// Cliente mínimo da Higgsfield (medido em 08/11/2026; a doc pública não traz isto).
// POST https://api.higgsfield.ai/{endpoint} com a entrada direto no corpo; header `Authorization: Key ID:SECRET`.
// Resposta: { status, request_id, status_url, cancel_url, expires_at }. Consulta: GET /requests/{id}/status até
// `completed`; imagem em images[0].url (expira em 7 dias). A resposta NÃO traz custo (tabela fixa em provedores.ts).
// Sem retry interno: cada chamada é uma requisição HTTP (a regra de `tentativa` vive na linha da galeria).

const BASE = 'https://api.higgsfield.ai'

export interface OpcoesHF {
  fetchFn?: typeof fetch
  /** `ID:SECRET` (ou o valor cru de HF_CREDENTIALS). Padrão: env HF_CREDENTIALS. */
  credenciais?: string
}

export type ErroHF = Error & { status: number }

/** HF_CREDENTIALS pode ter 3 partes (Copy ID + ID:SECRET); só as duas últimas autenticam. */
export function credenciaisHF(bruto: string): string {
  const partes = bruto.trim().split(':')
  return partes.slice(-2).join(':')
}

function cabecalho(op: OpcoesHF): Record<string, string> {
  const bruto =
    op.credenciais ?? (typeof Deno !== 'undefined' ? Deno.env.get('HF_CREDENTIALS') : undefined) ?? ''
  return { Authorization: `Key ${credenciaisHF(bruto)}`, 'Content-Type': 'application/json' }
}

async function chamar(url: string, init: RequestInit, op: OpcoesHF): Promise<any> {
  const res = await (op.fetchFn ?? globalThis.fetch)(url, init)
  if (!res.ok) {
    const corpo = await res.text().catch(() => '')
    const erro = new Error(`Higgsfield HTTP ${res.status}: ${corpo.slice(0, 200)}`) as ErroHF
    erro.status = res.status
    throw erro
  }
  return res.json()
}

/** Submete a geração e devolve o request_id. */
export async function submeterHF(endpoint: string, entrada: Record<string, unknown>, op: OpcoesHF = {}): Promise<string> {
  const json = await chamar(
    `${BASE}/${endpoint}`,
    { method: 'POST', headers: cabecalho(op), body: JSON.stringify(entrada) },
    op,
  )
  if (!json?.request_id) throw Object.assign(new Error('Higgsfield sem request_id'), { status: 200 })
  return json.request_id as string
}

export interface ConsultaHF {
  status: 'pendente' | 'concluida' | 'falhou'
  url?: string
  erro?: string
}

export async function consultarHF(requestId: string, op: OpcoesHF = {}): Promise<ConsultaHF> {
  const json = await chamar(`${BASE}/requests/${requestId}/status`, { method: 'GET', headers: cabecalho(op) }, op)
  const status = String(json?.status ?? '')
  if (status === 'completed') {
    const url = json.images?.[0]?.url
    return url ? { status: 'concluida', url } : { status: 'falhou', erro: 'sem_imagem' }
  }
  if (status === 'nsfw') return { status: 'falhou', erro: 'nsfw' }
  if (status === 'queued' || status === 'in_progress') return { status: 'pendente' }
  return { status: 'falhou', erro: status || 'desconhecido' }
}
