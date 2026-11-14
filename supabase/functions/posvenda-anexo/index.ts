// Upload de foto/PDF para o ML (ADR-0192). Chamada pelo frontend (JWT, multipart). Devolve o identificador
// do anexo, que a ação (posvenda-acao) referencia depois. O upload em si não altera a reclamação.
// Com corpo JSON: download (só leitura) de anexo recebido numa conversa (pack_id) ou reclamação (claim_id).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import {
  anexoDaConversa, anexoDaReclamacao, motivoDownloadBloqueado, nomeDoAnexo, validarArquivoAnexo,
  type AnexoMensagem, type DestinoAnexo,
} from '../_shared/faturamento/posvenda.ts';

const API = 'https://api.mercadolibre.com/post-purchase/v1/claims';
const API_MSG = 'https://api.mercadolibre.com/messages/attachments';
const QS_MSG = 'tag=post_sale&site_id=MLB';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status: number) => json({ ok: false, erro: msg }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const ehJson = (req.headers.get('content-type') ?? '').includes('application/json');
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: ehJson ? 'read' : 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();

  // Token ML da org do usuário; devolve Response de erro quando não há conexão.
  async function tokenDaOrg(): Promise<string | Response> {
    const { data: cxRow } = await admin.from('marketplace_connections')
      .select('id, org_id, canal, conta_externa_id, expires_at')
      .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
    const conexao = mapearConexao(cxRow ?? null);
    if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);
    try { return await getValidAccessTokenConexao(conexao); }
    catch { return erro('Conta ML não conectada.', 400); }
  }

  if (ehJson) {
    // Download: o acesso é decidido pela org dona da conversa (org_id + pack_id) ou da reclamação
    // (org_id + claim_id), nunca por user_id. Só leitura no ML.
    const body = await req.json().catch(() => null) as { pack_id?: unknown; claim_id?: unknown; filename?: unknown } | null;
    const pack = String(body?.pack_id ?? '').trim();
    const claim = String(body?.claim_id ?? '').trim();
    const filename = typeof body?.filename === 'string' ? body.filename : '';
    if (claim ? !/^\d+$/.test(claim) : !/^\d+$/.test(pack)) return erro(claim ? 'claim_id inválido' : 'pack_id inválido', 400);
    if (!filename) return erro('filename inválido', 400);
    let anexo: AnexoMensagem | null;
    let tk: string | Response | null = null;
    if (claim) {
      const { data: dev } = await admin.from('ml_devolucoes').select('claim_id')
        .eq('org_id', orgId).eq('claim_id', claim).maybeSingle();
      if (!dev) return erro('Reclamação não encontrada.', 404);
      tk = await tokenDaOrg();
      if (tk instanceof Response) return tk;
      // As mensagens da reclamação não ficam no banco: confere no ML que o anexo é desta reclamação.
      let msgs: Response;
      try { msgs = await fetch(`${API}/${claim}/messages`, { headers: { Authorization: `Bearer ${tk}` } }); }
      catch { return erro('Falha ao falar com o Mercado Livre. Tente de novo.', 502); }
      if (!msgs.ok) return erro(`O ML recusou a leitura da reclamação (${msgs.status}).`, 502);
      anexo = anexoDaReclamacao(await msgs.json().catch(() => null), filename);
    } else {
      const { data: rows } = await admin.from('ml_mensagens').select('raw')
        .eq('org_id', orgId).eq('pack_id', pack);
      anexo = anexoDaConversa((rows ?? []).map((r: { raw: unknown }) => r.raw), filename);
    }
    if (!anexo) return erro('Anexo não encontrado.', 404);
    const bloqueio = motivoDownloadBloqueado(anexo);
    if (bloqueio) return erro(bloqueio, 403);
    if (!tk) tk = await tokenDaOrg();
    if (tk instanceof Response) return tk;
    const urlDownload = claim
      ? `${API}/${claim}/attachments/${encodeURIComponent(filename)}/download`
      : `${API_MSG}/${encodeURIComponent(filename)}?${QS_MSG}`;
    let r: Response;
    try {
      r = await fetch(urlDownload, { headers: { Authorization: `Bearer ${tk}` } });
    } catch { return erro('Falha ao falar com o Mercado Livre. Tente de novo.', 502); }
    if (r.status === 404) return json({ ok: false, erro: 'Anexo indisponível no Mercado Livre.', codigo: 'anexo_indisponivel' }, 404);
    if (!r.ok) return erro(`O ML recusou o download (${r.status}).`, 502);
    return new Response(await r.arrayBuffer(), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': anexo.type!, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return erro('Formulário inválido', 400); }
  const claimId = String(form.get('claim_id') ?? '').trim();
  const packId = String(form.get('pack_id') ?? '').trim();
  const destino = form.get('destino');
  const file = form.get('file');
  if (destino !== 'revisao' && destino !== 'mensagem' && destino !== 'mensagem_pack') return erro('destino inválido', 400);
  const porPack = destino === 'mensagem_pack';
  if (porPack ? !/^\d+$/.test(packId) : !/^\d+$/.test(claimId)) return erro(porPack ? 'pack_id inválido' : 'claim_id inválido', 400);
  if (!(file instanceof File)) return erro('Arquivo ausente', 400);
  const invalido = validarArquivoAnexo(file.type, file.size, destino as DestinoAnexo);
  if (invalido) return erro(invalido, 400);

  if (porPack) {
    const { data: conv } = await admin.from('ml_mensagens').select('pack_id')
      .eq('org_id', orgId).eq('pack_id', packId).limit(1).maybeSingle();
    if (!conv) return erro('Conversa não encontrada.', 404);
  } else {
    const { data: dev } = await admin.from('ml_devolucoes').select('claim_id')
      .eq('org_id', orgId).eq('claim_id', claimId).maybeSingle();
    if (!dev) return erro('Reclamação não encontrada.', 404);
  }

  const token = await tokenDaOrg();
  if (token instanceof Response) return token;

  const url = porPack ? `${API_MSG}?${QS_MSG}`
    : destino === 'revisao' ? `${API}/${claimId}/returns/attachments` : `${API}/${claimId}/attachments`;
  const fd = new FormData();
  fd.append('file', file, file.name);
  let resp: Response;
  try { resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd }); }
  catch { return erro('Falha ao falar com o Mercado Livre. Tente de novo.', 502); }

  if (resp.status === 403) return erro('Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita).', 403);
  if (resp.status === 404) return erro(porPack ? 'Anexo não aceito pelo Mercado Livre.' : 'Reclamação não encontrada no Mercado Livre.', 404);
  if (!resp.ok) return erro(`O ML recusou o arquivo (${resp.status}).`, 502);
  const nome = nomeDoAnexo(await resp.json().catch(() => null), destino as DestinoAnexo);
  if (!nome) return erro('O ML não devolveu o identificador do anexo', 502);
  return json({ ok: true, nome });
});
