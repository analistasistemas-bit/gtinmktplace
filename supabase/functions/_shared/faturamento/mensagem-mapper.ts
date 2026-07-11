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

/** Extrai o array de mensagens da resposta do pack (defensivo a mudanças de shape). */
export function extrairMensagens(resp: unknown): MensagemML[] {
  const arr = (resp as { messages?: unknown })?.messages;
  return Array.isArray(arr) ? (arr as MensagemML[]) : [];
}
