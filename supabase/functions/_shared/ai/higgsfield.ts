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
  /** Teto da chamada. O lease da galeria é 150 s; a chamada não passa de 100 s. */
  timeoutMs?: number
}

export const TIMEOUT_HF_MS = 100_000

export type ErroHF = Error & { status: number }

/** HF_CREDENTIALS pode ter 3 partes (Copy ID + ID:SECRET); só as duas últimas autenticam. */
export function credenciaisHF(bruto: string | undefined | null): string {
  const partes = (bruto ?? '').trim().split(':')
  if (partes.length < 2 || partes.slice(-2).some((p) => !p)) {
    throw new Error('HF_CREDENTIALS ausente ou fora do formato ID:SECRET')
  }
  return partes.slice(-2).join(':')
}

function cabecalho(op: OpcoesHF): Record<string, string> {
  const bruto =
    op.credenciais ?? (typeof Deno !== 'undefined' ? Deno.env.get('HF_CREDENTIALS') : undefined) ?? ''
  return { Authorization: `Key ${credenciaisHF(bruto)}`, 'Content-Type': 'application/json' }
}

async function chamar(url: string, init: RequestInit, op: OpcoesHF): Promise<Record<string, unknown>> {
  const res = await (op.fetchFn ?? globalThis.fetch)(url, { ...init, signal: AbortSignal.timeout(op.timeoutMs ?? TIMEOUT_HF_MS) })
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
  const headers = cabecalho(op) // valida credencial antes de qualquer fetch
  const json = await chamar(
    `${BASE}/${endpoint}`,
    { method: 'POST', headers, body: JSON.stringify(entrada) },
    op,
  )
  if (typeof json?.request_id !== 'string' || !json.request_id) throw Object.assign(new Error('Higgsfield sem request_id'), { status: 200 })
  return json.request_id
}

export interface ConsultaHF {
  status: 'pendente' | 'concluida' | 'falhou'
  url?: string
  erro?: string
}

export async function consultarHF(requestId: string, op: OpcoesHF = {}): Promise<ConsultaHF> {
  const headers = cabecalho(op)
  const json = await chamar(`${BASE}/requests/${requestId}/status`, { method: 'GET', headers }, op)
  const status = String(json?.status ?? '')
  if (status === 'completed') {
    const url = (json.images as { url?: string }[] | undefined)?.[0]?.url
    return url ? { status: 'concluida', url } : { status: 'falhou', erro: 'sem_imagem' }
  }
  if (status === 'nsfw') return { status: 'falhou', erro: 'nsfw' }
  if (status === 'queued' || status === 'in_progress') return { status: 'pendente' }
  return { status: 'falhou', erro: status || 'desconhecido' }
}
