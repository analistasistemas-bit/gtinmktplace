// ADR-0181 Plano 2b-2: validação pura do corpo de `inventario`. Sem import de Deno (roda no vitest).

export interface ItemContagem { codigo: string; quantidade_contada: number | null; justificativa: string | null }

export type Corpo =
  | { acao: 'hoje' }
  | { acao: 'foto'; data_base: string }
  | { acao: 'salvar'; inventario_id: string; versao: number; itens: ItemContagem[] }
  | { acao: 'confirmar'; inventario_id: string; versao: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_BASE = /^\d{4}-12-31$/;

type Res = { ok: true; corpo: Corpo } | { ok: false; erro: string };
const erro = (e: string): Res => ({ ok: false, erro: e });

export function validarCorpo(bruto: unknown): Res {
  if (!bruto || typeof bruto !== 'object') return erro('Corpo inválido.');
  const b = bruto as Record<string, unknown>;
  if (b.acao === 'hoje') return { ok: true, corpo: { acao: 'hoje' } };
  if (b.acao === 'foto') {
    if (typeof b.data_base !== 'string' || !DATA_BASE.test(b.data_base)) return erro('data_base deve ser AAAA-12-31.');
    return { ok: true, corpo: { acao: 'foto', data_base: b.data_base } };
  }
  if (b.acao !== 'salvar' && b.acao !== 'confirmar') return erro('Ação desconhecida.');
  if (typeof b.inventario_id !== 'string' || !UUID.test(b.inventario_id)) return erro('inventario_id inválido.');
  if (!Number.isInteger(b.versao) || (b.versao as number) < 0) return erro('versao deve ser inteira.');
  const versao = b.versao as number;
  if (b.acao === 'confirmar') return { ok: true, corpo: { acao: 'confirmar', inventario_id: b.inventario_id, versao } };

  if (!Array.isArray(b.itens)) return erro('itens deve ser uma lista.');
  const itens: ItemContagem[] = [];
  for (const cru of b.itens) {
    const i = (cru ?? {}) as Record<string, unknown>;
    const codigo = typeof i.codigo === 'string' ? i.codigo.trim() : '';
    if (!codigo) return erro('Item sem código.');
    const q = i.quantidade_contada ?? null;
    if (q !== null && (!Number.isInteger(q) || (q as number) < 0)) {
      return erro(`Contagem de ${codigo} inválida: deve ser inteiro ≥ 0.`);
    }
    if (i.justificativa != null && typeof i.justificativa !== 'string') return erro(`Justificativa de ${codigo} inválida.`);
    itens.push({ codigo, quantidade_contada: q as number | null, justificativa: (i.justificativa as string | null | undefined) ?? null });
  }
  return { ok: true, corpo: { acao: 'salvar', inventario_id: b.inventario_id, versao, itens } };
}
