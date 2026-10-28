// Mapeamento puro de mensagens pós-venda do ML (ADR-0067). Sem Deno/npm — testável no vitest.
// Formato de GET /messages/packs/{pack}/sellers/{seller}: { messages: [ ... ] }.

/** Recorte de uma mensagem do ML. */
export interface MensagemML {
  id?: string | number | null;
  from?: { user_id?: string | number | null } | null;
  to?: { user_id?: string | number | null } | null;
  text?: string | null;
  message_date?: {
    received?: string | null;
    created?: string | null;
    available?: string | null;
    notified?: string | null;
    read?: string | null;
  } | null;
  status?: string | null;
}

export interface MensagemRow {
  message_id: string;
  direcao: 'recebida' | 'enviada';
  texto: string;
  data_ml: string | null;
}

const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Mapeia uma mensagem do ML para linha da tabela. `sellerId` decide a direção. */
export function mapearMensagem(m: MensagemML, sellerId: string | number): MensagemRow {
  const from = str(m.from?.user_id ?? null);
  const enviada = from != null && String(from) === String(sellerId);
  const d = m.message_date ?? null;
  return {
    message_id: String(m.id ?? ''),
    direcao: enviada ? 'enviada' : 'recebida',
    texto: m.text ?? '',
    // `created` é quando a mensagem foi criada; `received` como fallback.
    data_ml: d?.created ?? d?.received ?? null,
  };
}

/** Pack de uma mensagem, pela resposta de GET /messages/{id}: `message_resources[name=packs].id`. */
export function packDaMensagem(resp: unknown): string | null {
  const m = extrairMensagens(resp)[0] as { message_resources?: Array<{ id?: unknown; name?: unknown }> } | undefined;
  const pack = m?.message_resources?.find((r) => r?.name === 'packs')?.id;
  return pack != null && /^\d+$/.test(String(pack)) ? String(pack) : null;
}

/** Packs com mensagem não lida, pela resposta de GET /messages/unread?role=seller&tag=post_sale. */
export function packsNaoLidos(resp: unknown): string[] {
  const res = (resp as { results?: unknown })?.results;
  if (!Array.isArray(res)) return [];
  return res.map((r) => String((r as { resource?: unknown })?.resource ?? '').match(/^\/packs\/(\d+)\//)?.[1])
    .filter((p): p is string => !!p);
}

/** Extrai o array de mensagens da resposta do pack (defensivo a mudanças de shape). */
export function extrairMensagens(resp: unknown): MensagemML[] {
  const arr = (resp as { messages?: unknown })?.messages;
  return Array.isArray(arr) ? (arr as MensagemML[]) : [];
}
