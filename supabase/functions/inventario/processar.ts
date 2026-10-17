// ADR-0181 Plano 2b-2: miolo da edge `inventario`, deps injetadas (testável sem Deno).
// O JSON das leituras é repassado sem reprocessar (cabe nos 2 s de CPU, ADR-0173).
import type { Corpo } from './validar.ts';

export interface ErroRpc { message: string; code?: string }
export interface DepsInventario {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ErroRpc | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: boolean }, orgId: string): Promise<string>;
}
export interface Saida { status: number; body: unknown; headers?: Record<string, string> }

function traduzir(e: ErroRpc): Saida {
  switch (e.code) {
    case '40001': return { status: 409, body: { error: e.message } };   // versão obsoleta ou guard canônico
    case '23514': return { status: 422, body: { error: e.message } };
    case 'P0002': return { status: 404, body: { error: e.message } };
    case '22023': return { status: 400, body: { error: e.message } };
    default:
      console.error('inventario_rpc_falhou', e.code, e.message);
      return { status: 500, body: { error: 'Falha interna no inventário.' } };
  }
}

/** X-Org-Id + expose: o card confere a org da resposta (como baixar-notas-venda). */
const ok = (orgId: string, body: unknown): Saida => ({
  status: 200, body, headers: { 'X-Org-Id': orgId, 'Access-Control-Expose-Headers': 'X-Org-Id' },
});

export async function processarInventario(
  deps: DepsInventario, p: { corpo: Corpo; orgId: string; userId: string },
): Promise<Saida> {
  const { corpo, orgId } = p;
  if (corpo.acao === 'hoje') {
    const r = await deps.rpc('inventario_hoje_json', { p_org: orgId });
    return r.error ? traduzir(r.error) : ok(orgId, r.data);
  }
  if (corpo.acao === 'foto') {
    const r = await deps.rpc('inventario_foto_json', { p_org: orgId, p_data_base: corpo.data_base });
    if (r.error) return traduzir(r.error);
    return ok(orgId, r.data == null ? { vazio: true } : r.data);
  }
  if (corpo.acao === 'salvar') {
    const r = await deps.rpc('salvar_contagem_inventario', {
      p_org: orgId, p_id: corpo.inventario_id, p_versao: corpo.versao, p_itens: corpo.itens,
    });
    if (r.error) return traduzir(r.error);
    return ok(orgId, { versao: Number(r.data) });
  }
  const r = await deps.rpc('confirmar_inventario', {
    p_org: orgId, p_id: corpo.inventario_id, p_versao: corpo.versao, p_user: p.userId,
  });
  if (r.error) return traduzir(r.error);
  const produtos = (r.data as { produtos?: { codigo_pai: string; reativar: boolean }[] } | null)?.produtos ?? [];
  // Commit já feito: falha no enqueue não desfaz; o operador repete `confirmar` (idempotente) e reenfileira.
  let push: 'ok' | 'pendente' = 'ok';
  for (const pr of produtos) {
    try {
      await deps.enfileirar({ org_id: orgId, codigo_pai: pr.codigo_pai, canal_origem: null, reativar: !!pr.reativar }, orgId);
    } catch (e) {
      push = 'pendente';
      console.error('inventario_push_falhou', pr.codigo_pai, String(e));
    }
  }
  return ok(orgId, { push });
}
