// ADR-0188: ação set_marca_org (super-admin) — liga/desliga a marca própria e define o nome que sai
// como Marca no ML. Isolada do Deno.serve para teste (molde arquivar-org.ts).
export interface MarcaOrgDeps {
  ehSuperAdmin: boolean;
  orgAlvo: string;
  marcaPropria: unknown;
  marcaPadrao: unknown;
  /** Devolve a mensagem de erro do banco, ou null. */
  atualizar: (orgId: string, patch: { marca_propria: boolean; marca_padrao?: string }) => Promise<string | null>;
  auditar: (orgId: string, result: 'intent' | 'success' | 'failure', details?: Record<string, unknown>) => Promise<string | null>;
}
export interface Resposta { status: number; body: Record<string, unknown> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOME = 60;

export async function executarMarcaOrg(d: MarcaOrgDeps): Promise<Resposta> {
  if (!d.ehSuperAdmin) return { status: 403, body: { error: 'forbidden' } };
  if (!UUID.test(d.orgAlvo)) return { status: 400, body: { error: 'org_id inválido.' } };
  if (typeof d.marcaPropria !== 'boolean') return { status: 400, body: { error: 'marca_propria (true|false) obrigatório.' } };
  const nome = typeof d.marcaPadrao === 'string' ? d.marcaPadrao.trim() : '';
  if (d.marcaPropria && !nome) return { status: 400, body: { error: 'Informe o nome da marca.' } };
  if (nome.length > MAX_NOME) return { status: 400, body: { error: `Nome da marca com no máximo ${MAX_NOME} caracteres.` } };

  // Desligar sem nome não apaga marca_padrao: ela segue sendo o fallback da criação (D-E7.3).
  const patch = nome ? { marca_propria: d.marcaPropria, marca_padrao: nome } : { marca_propria: d.marcaPropria };
  if (await d.auditar(d.orgAlvo, 'intent', patch)) return { status: 500, body: { error: 'Falha ao registrar a auditoria.' } };
  const erro = await d.atualizar(d.orgAlvo, patch);
  if (await d.auditar(d.orgAlvo, erro ? 'failure' : 'success', patch)) {
    return { status: 500, body: { error: 'Falha ao registrar a auditoria.' } };
  }
  if (erro) return { status: 400, body: { error: erro } };
  return { status: 200, body: { ok: true } };
}
