// Mapeamento puro de perguntas do ML (ADR-0037). Sem Deno/npm — testável no vitest.

/** Recorte de /questions/{id} do ML. */
export interface PerguntaML {
  id?: number | string;
  text?: string | null;
  status?: string | null;
  item_id?: string | null;
  date_created?: string | null;
  from?: { id?: number | string | null; nickname?: string | null } | null;
  answer?: { text?: string | null; status?: string | null; date_created?: string | null } | null;
}

export interface PerguntaRow {
  question_id: number;
  item_id: string | null;
  texto: string;
  status: string;
  resposta: string | null;
  respondida_em: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
  criada_em: string | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function mapearPergunta(q: PerguntaML): PerguntaRow {
  return {
    question_id: Number(q.id),
    item_id: q.item_id ?? null,
    texto: q.text ?? '',
    status: q.status ?? 'UNKNOWN',
    resposta: q.answer?.text ?? null,
    respondida_em: q.answer?.date_created ?? null,
    comprador_id: num(q.from?.id ?? null),
    comprador_nick: q.from?.nickname?.trim() || null,
    criada_em: q.date_created ?? null,
  };
}

/**
 * O ML v4 devolve `from: { id }` sem `nickname` (verificado em 2026-08-06 com o token do vendedor
 * dono, em `/questions/{id}` e `/questions/search`) — e o campo some quando quem consulta não é o
 * vendedor. Rede defensiva: payload sem `from` não pode apagar o comprador já gravado.
 */
export function preservarComprador(
  row: Pick<PerguntaRow, 'comprador_id' | 'comprador_nick'>,
  anterior: { comprador_id?: number | null; comprador_nick?: string | null } | null | undefined,
): { comprador_id: number | null; comprador_nick: string | null } {
  return {
    comprador_id: row.comprador_id ?? anterior?.comprador_id ?? null,
    comprador_nick: row.comprador_nick ?? anterior?.comprador_nick ?? null,
  };
}

/** true quando a pergunta está sem resposta (gera badge/alerta). */
export function naoRespondida(status: string | null | undefined): boolean {
  return status === 'UNANSWERED';
}
