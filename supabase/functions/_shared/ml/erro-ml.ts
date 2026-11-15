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

// Bug real 2026-09-06 (Kit Virtual): `cause` às vezes vem como array de STRINGS puras
// (`["thumbnail.secureUrl must not be null"]`), não só de objetos `{code,message,type}` — o
// código assumia sempre objeto, então `c.message`/`c.code` davam `undefined` numa string e o
// erro real virava "erro não especificado" (o diagnóstico do ML se perdia). Normaliza os dois
// formatos aqui, num único ponto, antes de qualquer heurística.
function normalizarCausa(c: string | Causa): Causa {
  return typeof c === 'string' ? { message: c } : c;
}

// Diego (15/11): toda mensagem ao cliente em pt-BR. O texto cru do ML (quase sempre inglês) nunca
// entra na mensagem: vai para o log em `humanizarErroML`. Da causa só aproveitamos os códigos de
// atributo (ex.: PRODUCT_CONSERVATION), que são o que o operador precisa para corrigir.

/** Códigos de atributo citados pelo ML: lista `[A, B]` só de ids (`attributes [X]`) ou `attribute X`.
 *  Nunca valores (`invalid value [12345]`) nem palavras soltas em caixa alta (`must be STRING`). */
const ID_ATRIBUTO = /^[A-Z][A-Z0-9_]*$/;
const TIPOS = new Set(['STRING', 'NUMBER', 'BOOLEAN', 'LIST', 'ERROR']);
function atributosCitados(msg: string): string[] {
  const ids: string[] = [];
  for (const m of msg.matchAll(/\b[Aa]ttributes?\s*\[([^\]]*)\]/g)) ids.push(...m[1].split(',').map((t) => t.trim()));
  for (const m of msg.matchAll(/\b[Aa]ttributes?\s+([A-Z][A-Z0-9_]*)\b/g)) ids.push(m[1]);
  // Sem "attribute X" (ex.: "BRAND obrigatório"): tokens soltos em caixa alta, menos id de categoria e nome de tipo.
  if (ids.length === 0) ids.push(...(msg.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []).filter((t) => !TIPOS.has(t)));
  return [...new Set(ids.filter((t) => ID_ATRIBUTO.test(t) && !/^MLB\d+$/.test(t)))];
}

const GENERICO = 'O Mercado Livre recusou o anúncio por um motivo que o PubliAI ainda não reconhece. O detalhe ficou registrado para o suporte.';

function humanizarCausa(c: Causa): string {
  const code = (c.code ?? '').toLowerCase();
  const msg = c.message ?? '';
  if (code.includes('title') && code.includes('length')) {
    return 'O título passou de 60 caracteres (limite da categoria no Mercado Livre). Encurte o título na revisão.';
  }
  if (code.includes('title')) return 'O Mercado Livre recusou o título do anúncio. Revise o título e clique em Reenviar.';
  // Prefixo "Problema nas fotos" é mantido: ehErroDefinitivoFoto (publish-familia-ml) depende dele para limpar o cache.
  if (/does not exist/i.test(msg)) {
    return /picture|image|thumbnail|foto/i.test(msg) || code.includes('picture')
      ? 'Problema nas fotos do anúncio: uma imagem enviada não existe mais no Mercado Livre. Clique em Reenviar.'
      : 'Um item enviado não existe mais no Mercado Livre. Clique em Reenviar.';
  }
  if (/picture|image|thumbnail/.test(code) || (!code && /picture|image|thumbnail/i.test(msg))) {
    // "has status ERROR": o ML baixou a foto e não conseguiu processar — caso real 08/11 foi PNG de 37 MB.
    if (/status ERROR/i.test(msg)) {
      // ponytail: status ERROR também cobre falha de download/formato — tamanho é a causa provável, não a única.
      return 'Problema nas fotos do anúncio: o Mercado Livre não conseguiu processar uma das imagens. '
        + 'Confira as fotos do produto: se alguma estiver pesada (acima de 10 MB) ou com resolução muito alta, '
        + 'troque a foto por uma menor (até 10 MB, cerca de 2000 px no lado maior); se estiver corrompida ou em formato '
        + 'diferente de JPG/PNG, troque também. Depois clique em Reenviar.';
    }
    return 'Problema nas fotos do anúncio: o Mercado Livre recusou uma das imagens. Verifique as fotos e clique em Reenviar.';
  }
  if (code.includes('price')) return 'O Mercado Livre recusou o preço do anúncio. Revise o preço e clique em Reenviar.';
  if (code.includes('gtin') || code.includes('ean')) {
    return 'O Mercado Livre recusou o código de barras (GTIN). Confira o GTIN do produto e clique em Reenviar.';
  }
  if (code.includes('attribute')) {
    const ids = atributosCitados(msg);
    const quais = ids.length ? `: ${ids.join(', ')}` : '';
    return code.includes('missing') || /required/i.test(msg)
      ? `A categoria exige atributo(s) que não foram enviados${quais}. Revise os atributos da categoria e clique em Reenviar.`
      : `O Mercado Livre recusou atributo(s) do anúncio${quais}. Revise os atributos da categoria e clique em Reenviar.`;
  }
  if (code.includes('variation')) return 'O Mercado Livre recusou as variações (cores) do anúncio. Revise as variações e clique em Reenviar.';
  if (code.includes('category')) return 'O Mercado Livre recusou a categoria do anúncio. Revise a categoria e clique em Reenviar.';
  if (code.includes('description')) return 'O Mercado Livre recusou a descrição do anúncio. Revise a descrição e clique em Reenviar.';
  if (code.includes('stock') || code.includes('quantity')) return 'O Mercado Livre recusou o estoque do anúncio. Revise o estoque e clique em Reenviar.';
  return GENERICO;
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

// ─── Detecção reativa de GTIN obrigatório (ADR-0151 D-5 revisada) ─────────

/** Recusa do ML por GTIN faltando: `item.attribute.missing_conditional_required` citando [GTIN].
 *  Vale para o kit vinculado, que publica sem GTIN por padrão — em categorias que exigem o código
 *  de verdade (alimentos, ex. MLB455708) nenhum EMPTY_GTIN_REASON substitui, verificado por
 *  dry-run em /items/validate (2026-09-03). Reagir aqui evita hard-code de lista de categorias. */
export function precisaGtinDePack(status: number | null | undefined, mlCauses: unknown): boolean {
  if (status !== 400) return false;
  const causas: Causa[] = Array.isArray(mlCauses) ? (mlCauses as Causa[]) : [];
  return causas
    .filter((c) => (c?.type ?? 'error') !== 'warning')
    .some((c) => (c?.code ?? '').includes('missing_conditional_required') && /\[GTIN\]/.test(c?.message ?? ''));
}

export function humanizarErroML(status: number, json: unknown): string {
  const j = (json ?? {}) as { message?: string; error?: string; cause?: unknown };
  const causesBrutas: (string | Causa)[] = Array.isArray(j.cause)
    ? (j.cause as (string | Causa)[])
    : j.cause
      ? [j.cause as string | Causa]
      : [];
  const causes: Causa[] = causesBrutas.map(normalizarCausa);
  // Só o que bloqueia a publicação (ignora warnings, ex.: frete grátis).
  const bloqueantes = causes.filter((c) => (c?.type ?? 'error') !== 'warning');
  const usar = bloqueantes.length ? bloqueantes : causes;

  // Texto cru do ML só no log (diagnóstico); o cliente vê pt-BR.
  if (usar.length || j.message || j.error) console.error('ml_erro_bruto', status, JSON.stringify(json));
  const msgs = [...new Set(usar.map(humanizarCausa).filter(Boolean))];
  if (msgs.length) return msgs.join(' ');

  // Sem `cause`: a `message` do topo passa pela mesma classificação (ex.: foto "does not exist"
  // precisa do sinal que limpa o cache), mas nunca é devolvida crua.
  const topo = j.message ?? j.error;
  const h = topo ? humanizarCausa({ message: topo }) : GENERICO;
  return h === GENERICO ? `O Mercado Livre recusou (erro ${status}).` : h;
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
