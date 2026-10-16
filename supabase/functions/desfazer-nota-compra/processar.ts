export interface DepsDesfazer {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: boolean }, orgId: string): Promise<string>;
}
export async function processarDesfazer(
  deps: DepsDesfazer,
  p: { orgId: string; userId: string; notaId: string; status: 'desfeita' | 'cancelada' },
): Promise<{ pushOk: boolean; jaEstava: boolean }> {
  const { data, error } = await deps.rpc('desfazer_nota_compra', {
    p_org: p.orgId, p_user: p.userId, p_nota_id: p.notaId, p_status: p.status,
  });
  if (error) throw new Error(error.message);
  const r = data as { codigos_pai: string[]; ja_estava: boolean };
  let pushOk = true;
  for (const codigoPai of r.codigos_pai) {
    try {
      // R3-B4: desfazer/cancelar só REDUZ saldo — nunca reativa anúncio pausado pelo operador.
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: false }, p.orgId);
    } catch (e) { pushOk = false; console.error('desfazer_nota_push_falhou', codigoPai, String(e)); }
  }
  return { pushOk, jaEstava: r.ja_estava };
}
