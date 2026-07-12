// Humaniza o erro de validação do ML. O ML devolve `message` genérico ("Validation
// error") e o detalhe real no array `cause` (com `code`/`message`/`type`). Aqui
// extraímos as causas que de fato BLOQUEIAM (type !== 'warning') e traduzimos os
// códigos conhecidos para PT-BR dizendo o que corrigir; o resto mostra a mensagem
// específica do ML (melhor que "Validation error").

interface Causa {
  code?: string;
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
  constructor(status: number | null, message: string) {
    super(message);
    this.name = 'MLApiError';
    this.status = status;
  }
}

export type ClassificacaoErroML = 'permanente-auth' | 'transiente' | 'nao-encontrado';

/** 401/403 = token morto (não conserta sozinho); 404 = recurso realmente ausente;
 *  qualquer outra coisa (429/5xx/timeout/status null de erro de rede) = transiente, vale retry. */
export function classificarErroML(status: number | null): ClassificacaoErroML {
  if (status === 401 || status === 403) return 'permanente-auth';
  if (status === 404) return 'nao-encontrado';
  return 'transiente';
}
