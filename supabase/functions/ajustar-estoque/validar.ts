// E6b (ADR-0110): validação pura do corpo de `ajustar-estoque`. Sem import de Deno de
// propósito — assim roda no vitest do frontend, como `_shared/split/capar-estoque.ts`.

export interface ItemAjuste { codigo: string; novoSaldo: number }

/** Teto do ML (ADR-0048, capar-estoque.ts). O ajuste só reduz; isto é trava barata. */
export const TETO_SALDO = 99999;

/**
 * Uma referência de idempotência POR ITEM. O índice é (org_id, referencia_externa): uma ref
 * compartilhada pela lista inteira faria o 2º item colidir e ser lido como duplicata — o
 * "Zerar tudo" aplicaria só a primeira cor e devolveria sucesso.
 */
export function refDoItem(ref: string, codigo: string): string {
  return `ajuste:${ref}:${codigo}`;
}

export function validarAjustes(
  bruto: unknown,
): { ok: true; itens: ItemAjuste[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, erro: 'Informe ao menos um SKU.' };
  }
  const itens: ItemAjuste[] = [];
  const vistos = new Set<string>();
  for (const cru of bruto) {
    const codigo = String((cru as ItemAjuste)?.codigo ?? '').trim();
    if (!codigo) return { ok: false, erro: 'Item sem SKU na lista de ajustes.' };
    // Repetido é erro, nunca dedupe silencioso: as duas ocorrências gerariam a MESMA
    // referência e a segunda voltaria como "duplicada" sem ter sido aplicada.
    if (vistos.has(codigo)) return { ok: false, erro: `SKU repetido na lista: ${codigo}.` };
    vistos.add(codigo);
    const novoSaldo = Number((cru as ItemAjuste)?.novoSaldo);
    if (!Number.isInteger(novoSaldo) || novoSaldo < 0 || novoSaldo > TETO_SALDO) {
      return { ok: false, erro: `Saldo de ${codigo} inválido: deve ser inteiro entre 0 e ${TETO_SALDO}.` };
    }
    itens.push({ codigo, novoSaldo });
  }
  return { ok: true, itens };
}
