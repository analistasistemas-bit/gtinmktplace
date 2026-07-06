import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { StatusCanal } from '../_shared/canais/contrato.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só membro autenticado da operação (o token ML usado é o da própria org).
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  // Escopo da organização (E7): a lista de anúncios é compartilhada dentro da org
  // (RLS org_id, D-E7.3), então o status ao vivo cobre os anúncios de toda a org.
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null);
  // Split (ADR-0048): anúncios de partições >0 vivem só em anuncios_externos; inclui seus ids
  // para o status ao vivo cobrir TODOS os anúncios do produto, não só a partição 0.
  const { data: extras } = await admin.from('anuncios_externos')
    .select('item_externo_id, canal').eq('org_id', orgId).not('item_externo_id', 'is', null);

  // E6 (ADR-0061): agrupa os ids por canal — familias.ml_item_id é sempre ML (dual-write);
  // anuncios_externos carrega o canal de cada linha. Hoje só existe 'mercado_livre', então o
  // agrupamento devolve exatamente o mesmo grupo único de antes.
  const idsPorCanal = new Map<string, Set<string>>();
  const addId = (canal: string, id: string) => {
    if (!idsPorCanal.has(canal)) idsPorCanal.set(canal, new Set());
    idsPorCanal.get(canal)!.add(id);
  };
  for (const f of familias ?? []) addId('mercado_livre', f.ml_item_id as string);
  for (const e of extras ?? []) addId(e.canal, e.item_externo_id as string);

  const totalIds = [...idsPorCanal.values()].reduce((n, s) => n + s.size, 0);
  if (totalIds === 0) {
    return new Response(JSON.stringify({ itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Leitura de status em lote por canal, via conector (ADR-0024). Canal sem conexão (ou cuja
  // leitura falha — getToken sem credencial válida) fica de fora do lote; para 'mercado_livre'
  // preserva o fallback semCredencialML de antes (hoje o único canal com dados reais).
  const itens: Array<{ ml_item_id: string; canal: string } & Partial<StatusCanal>> = [];
  let semCredencialML = false;
  for (const [canal, idsSet] of idsPorCanal) {
    const ids = [...idsSet];
    const conexao = await resolverConexao(admin, orgId, canal);
    if (!conexao) {
      if (canal === 'mercado_livre') semCredencialML = true;
      continue;
    }
    const conn = getConnector(canal);
    const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
    try {
      const statusPorId = await conn.lerStatus(ctx, ids);
      for (const id of ids) itens.push({ ml_item_id: id, canal, ...statusPorId[id] });
    } catch {
      if (canal === 'mercado_livre') semCredencialML = true;
    }
  }

  if (semCredencialML && itens.length === 0) {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ itens }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
