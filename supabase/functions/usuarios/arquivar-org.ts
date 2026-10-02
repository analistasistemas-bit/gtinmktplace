// ADR-0175: lógica das ações archive_org/unarchive_org, isolada do Deno.serve para teste.
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
export interface ArquivamentoDeps {
  orgAlvo: string;
  orgDoChamador: string | null;
  arquivar: boolean;
  existe: (orgId: string) => Promise<boolean>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  auditar: (orgId: string, result: 'intent' | 'success' | 'failure', details?: Record<string, unknown>) => Promise<string | null>;
}
export interface Resposta { status: number; body: Record<string, unknown> }

const STATUS_POR_CODIGO: Record<string, number> = { P0002: 404, '55000': 409 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executarArquivamento(d: ArquivamentoDeps): Promise<Resposta> {
  if (!d.orgAlvo || !UUID.test(d.orgAlvo)) return { status: 400, body: { error: 'org_id inválido' } };
  if (d.orgAlvo === d.orgDoChamador) return { status: 400, body: { error: 'Não é possível arquivar a sua própria empresa.' } };
  // platform_audit_events.org_id tem FK para organizations: auditar org inexistente daria 500.
  // `existe` LANÇA em erro de consulta — falha de banco não pode virar 404 (Codex rodada 2, #5).
  let existe: boolean;
  try { existe = await d.existe(d.orgAlvo); }
  catch (e) { return { status: 500, body: { error: `Falha ao ler a empresa: ${e instanceof Error ? e.message : String(e)}` } }; }
  if (!existe) return { status: 404, body: { error: 'Empresa não encontrada.' } };
  const intent = await d.auditar(d.orgAlvo, 'intent');
  if (intent) return { status: 500, body: { error: `Falha ao registrar auditoria (intent): ${intent}` } };
  const fn = d.arquivar ? 'arquivar_organizacao' : 'desarquivar_organizacao';
  const { data, error } = await d.rpc(fn, { p_org_id: d.orgAlvo });
  if (error) {
    const falha = await d.auditar(d.orgAlvo, 'failure', { code: error.code ?? null, message: error.message });
    if (falha) return { status: 500, body: { error: `Falha ao registrar auditoria (failure): ${falha}` } };
    return { status: STATUS_POR_CODIGO[error.code ?? ''] ?? 500, body: { error: error.message } };
  }
  const ok = await d.auditar(d.orgAlvo, 'success');
  if (ok) return { status: 500, body: { error: `Falha ao registrar auditoria (success): ${ok}` } };
  return { status: 200, body: d.arquivar ? { ok: true, arquivada_em: data } : { ok: true } };
}
