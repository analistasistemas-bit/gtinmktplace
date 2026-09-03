// Validação pura do corpo de `entrada-estoque`. Sem import de Deno de propósito — assim roda no
// vitest do frontend, como `ajustar-estoque/validar.ts`, do qual isto é o espelho.

export interface ItemEntrada { codigo: string; quantidade: number; custo: number | null }

/** Teto do ML (ADR-0048, capar-estoque.ts). */
export const TETO_SALDO = 99999;

/**
 * Uma referência de idempotência POR ITEM, pelo mesmo motivo do ajuste: o índice é
 * (org_id, referencia_externa), então uma ref compartilhada pela lista faria o 2º item colidir e
 * ser lido como duplicata — a entrada seria somada só na primeira cor, com sucesso aparente.
 *
 * O item ÚNICO mantém a ref histórica `entrada:<ref>` (sem o sufixo do código): mudar o formato
 * faria um retry de uma submissão antiga somar o saldo de novo, que é exatamente o que a
 * idempotência existe para impedir.
 */
export function refDoItem(ref: string, codigo: string, unico: boolean): string {
  return unico ? `entrada:${ref}` : `entrada:${ref}:${codigo}`;
}

/**
 * Aceita os dois formatos: `{ codigo, quantidade, custo }` (uma cor — o picker global) e
 * `{ itens: [...] }` (várias cores de um produto de uma vez). O formato antigo continua valendo
 * porque é o que qualquer aba já aberta continua enviando.
 */
export function validarEntrada(
  body: { codigo?: unknown; quantidade?: unknown; custo?: unknown; itens?: unknown },
): { ok: true; itens: ItemEntrada[]; unico: boolean } | { ok: false; erro: string } {
  const bruto = Array.isArray(body.itens)
    ? body.itens
    : [{ codigo: body.codigo, quantidade: body.quantidade, custo: body.custo }];
  const unico = !Array.isArray(body.itens);

  if (bruto.length === 0) return { ok: false, erro: 'Informe ao menos um SKU.' };

  const itens: ItemEntrada[] = [];
  const vistos = new Set<string>();
  for (const cru of bruto) {
    const c = cru as { codigo?: unknown; quantidade?: unknown; custo?: unknown };
    const codigo = String(c?.codigo ?? '').trim();
    if (!codigo) return { ok: false, erro: 'Informe o SKU.' };
    if (vistos.has(codigo)) return { ok: false, erro: `SKU repetido na lista: ${codigo}.` };
    vistos.add(codigo);

    const quantidade = Number(c?.quantidade ?? 0);
    if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > TETO_SALDO) {
      return { ok: false, erro: `Quantidade de ${codigo} deve ser um inteiro entre 1 e ${TETO_SALDO}.` };
    }

    // Custo alimenta markup e preço (ADR-0055): valor inválido FALHA aqui e de novo na RPC.
    // `null` NÃO apaga o custo do SKU — `registrar_entrada` faz `custo = coalesce(p_custo, custo)`.
    const custo = c?.custo == null ? null : Number(c.custo);
    if (custo !== null && !(custo > 0)) {
      return { ok: false, erro: `Custo de ${codigo}, quando informado, deve ser maior que zero.` };
    }
    itens.push({ codigo, quantidade, custo });
  }
  return { ok: true, itens, unico };
}
