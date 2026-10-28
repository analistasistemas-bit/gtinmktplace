// Upload de foto/PDF para o ML (ADR-0192). Chamada pelo frontend (JWT, multipart). Devolve o identificador
// do anexo, que a ação (posvenda-acao) referencia depois. O upload em si não altera a reclamação.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { nomeDoAnexo, validarArquivoAnexo, type DestinoAnexo } from '../_shared/faturamento/posvenda.ts';

const API = 'https://api.mercadolibre.com/post-purchase/v1/claims';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status: number) => json({ ok: false, erro: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let form: FormData;
  try { form = await req.formData(); } catch { return erro('Formulário inválido', 400); }
  const claimId = String(form.get('claim_id') ?? '').trim();
  const destino = form.get('destino');
  const file = form.get('file');
  if (!/^\d+$/.test(claimId)) return erro('claim_id inválido', 400);
  if (destino !== 'revisao' && destino !== 'mensagem') return erro('destino inválido', 400);
  if (!(file instanceof File)) return erro('Arquivo ausente', 400);
  const invalido = validarArquivoAnexo(file.type, file.size, destino as DestinoAnexo);
  if (invalido) return erro(invalido, 400);

  const admin = adminClient();
  const { data: dev } = await admin.from('ml_devolucoes').select('claim_id')
    .eq('org_id', orgId).eq('claim_id', claimId).maybeSingle();
  if (!dev) return erro('Reclamação não encontrada.', 404);

  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  const url = destino === 'revisao' ? `${API}/${claimId}/returns/attachments` : `${API}/${claimId}/attachments`;
  const fd = new FormData();
  fd.append('file', file, file.name);
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); }
  catch { return erro('Falha ao falar com o Mercado Livre. Tente de novo.', 502); }

  if (resp.status === 403) return erro('Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita).', 403);
  if (resp.status === 404) return erro('Reclamação não encontrada no Mercado Livre.', 404);
  if (!resp.ok) return erro(`O ML recusou o arquivo (${resp.status}).`, 502);
  const nome = nomeDoAnexo(await resp.json().catch(() => null), destino as DestinoAnexo);
  if (!nome) return erro('O ML não devolveu o identificador do anexo', 502);
  return json({ ok: true, nome });
});
