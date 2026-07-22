// Humaniza o erro de validação do ML. O ML devolve `message` genérico ("Validation
// error") e o detalhe real no array `cause` (com `code`/`message`/`type`). Aqui
// extraímos as causas que de fato BLOQUEIAM (type !== 'warning') e traduzimos os
// códigos conhecidos para PT-BR dizendo o que corrigir; o resto mostra a mensagem
// específica do ML (melhor que "Validation error").

interface Causa {
  code?: string;
  cause_id?: number;
  message?: string;
  type?: string;
}

function humanizarCausa(c: Causa): string {
  const code = (c.code ?? '').toLowerCase();
  const det = c.message ? ` (${c.message})` : '';
  if (code.includes('title') && code.includes('length')) {
    return 'O título passou de 60 caracteres (limite da categoria no Mercado Livre). Encurte o título na revisão.';
  }
  if (code.includes('title')) return `Problema no título${det}.`;
  if (code.includes('picture') || code.includes('image') || code.includes('thumbnail')) {
    return `Problema nas fotos do anúncio${det}. Verifique as imagens das variações.`;
  }
  if (code.includes('price')) return `Problema no preço${det}.`;
  if (code.includes('gtin') || code.includes('ean')) {
    return `Problema no código de barras / GTIN${det}.`;
  }
  if (code.includes('attribute')) return `Atributo obrigatório com problema${det}. Revise os atributos da categoria.`;
  if (code.includes('variation')) return `Problema nas variações (cores)${det}.`;
  if (code.includes('category')) return `Problema na categoria${det}.`;
  if (code.includes('description')) return `Problema na descrição${det}.`;
  if (code.includes('stock') || code.includes('quantity')) return `Problema no estoque${det}.`;
  return c.message ?? c.code ?? 'erro não especificado';
}

// O ML às vezes recusa o item por um erro TRANSIENTE de processamento de imagem
// ("Ocorreu um erro ao processar a foto. Por favor, envie-a novamente.") — vem como
// 4xx, mas some no retry. Detecta o pedido explícito de reenvio/retry (PT/ES/EN) em
// causes bloqueantes; erros permanentes (título >60, foto de baixa qualidade) não casam.
const PADRAO_RETENTAVEL = /novamente|de novo|nuevamente|\btry again\b|\bagain\b|reintent|temporar/i;

export function ehErroRetentavel(json: unknown): boolean {
  const j = (json ?? {}) as { cause?: unknown };
  const causes: Causa[] = Array.isArray(j.cause)
    ? (j.cause as Causa[])
    : j.cause
      ? [j.cause as Causa]
      : [];
  return causes
    .filter((c) => (c?.type ?? 'error') !== 'warning')
    .some((c) => PADRAO_RETENTAVEL.test(c?.message ?? ''));
}

// ─── Detecção reativa de item plano (ADR-0087, estende ADR-0084) ──────────

// Termos que cada causa precisa mencionar — defesa extra contra os `cause_id` sendo
// reaproveitados pelo ML em erros não relacionados (369/374 não são reservados a este caso).
// Os 3 termos da 369 são exigidos JUNTOS (não é o suficiente mencionar só 1 ou 2 — achado da
// revisão adversarial do Codex: alternação `a|b|c` deixava passar causa com só 1 dos termos).
const TERMOS_369 = [/family_name/i, /price/i, /available_quantity/i];
const TERMOS_374 = /variations/i;

/** Assinatura exata do 400 que só o item plano (family_name) resolve — ver ADR-0084/ADR-0087.
 *  Casa `status===400` + as 2 causas bloqueantes exatas (nenhuma causa bloqueante a mais) +
 *  as mensagens mencionando os termos esperados. Um match parcial devolve `false`: melhor
 *  propagar o erro original do que arriscar esconder um problema real de dado. */
export function precisaItemPlano(status: number | null | undefined, mlCauses: unknown): boolean {
  if (status !== 400) return false;
  const causas: Causa[] = Array.isArray(mlCauses) ? (mlCauses as Causa[]) : [];
  const bloqueantes = causas.filter((c) => (c?.type ?? 'error') !== 'warning');
  if (bloqueantes.length !== 2) return false;
  const tem369 = bloqueantes.some((c) => c.code === 'body.required_fields' && c.cause_id === 369
    && TERMOS_369.every((termo) => termo.test(c.message ?? '')));
  const tem374 = bloqueantes.some((c) => c.code === 'body.invalid_fields' && c.cause_id === 374 && TERMOS_374.test(c.message ?? ''));
  return tem369 && tem374;
}

export function humanizarErroML(status: number, json: unknown): string {
  const j = (json ?? {}) as { message?: string; error?: string; cause?: unknown };
  const causes: Causa[] = Array.isArray(j.cause)
    ? (j.cause as Causa[])
    : j.cause
      ? [j.cause as Causa]
      : [];
  // Só o que bloqueia a publicação (ignora warnings, ex.: frete grátis).
  const bloqueantes = causes.filter((c) => (c?.type ?? 'error') !== 'warning');
  const usar = bloqueantes.length ? bloqueantes : causes;

  const msgs = [...new Set(usar.map(humanizarCausa).filter(Boolean))];
  if (msgs.length) return msgs.join(' ');

  return j.message ?? j.error ?? `O Mercado Livre recusou (erro ${status}).`;
}

// ─── Liveness da integração (ADR-0069) ─────────────────────────────────────
// Classificação por STATUS HTTP (eixo diferente de `ehErroRetentavel`, que olha o
// corpo/padrão de mensagem de erro de publicação). Usada pelos workers de sync
// (venda/pergunta/devolução) e pela reconciliação para distinguir token morto de
// falha transiente, sem depender do corpo da resposta.

export class MLApiError extends Error {
  readonly status: number | null;
  readonly oauthError: string | null;
  constructor(status: number | null, message: string, oauthError: string | null = null) {
    super(message);
    this.name = 'MLApiError';
    this.status = status;
    this.oauthError = oauthError;
  }
}

export type ClassificacaoErroML = 'permanente-auth' | 'transiente' | 'nao-encontrado';

/** 401/403 = token morto (não conserta sozinho); OAuth2 `error: "invalid_grant"` (refresh_token
 *  revogado/expirado, RFC 6749 §5.2) também é token morto MESMO com status 400 — o ML usa 400
 *  aqui (ADR-0012). Outros erros 400 (invalid_client/invalid_scope/etc., inclusive o 400
 *  auto-induzido por uma corrida de refresh concorrente — ver ADR-0012 "condição de corrida")
 *  continuam transientes: não indicam necessariamente reconexão necessária. 404 = recurso
 *  realmente ausente; qualquer outra coisa (429/5xx/timeout/status null de erro de rede) =
 *  transiente, vale retry. */
export function classificarErroML(status: number | null, oauthError?: string | null): ClassificacaoErroML {
  if (status === 401 || status === 403) return 'permanente-auth';
  if (oauthError === 'invalid_grant') return 'permanente-auth';
  if (status === 404) return 'nao-encontrado';
  return 'transiente';
}
