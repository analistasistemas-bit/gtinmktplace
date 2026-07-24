// ADR-0088 — Reconciliador de BACKFILL (endpoint administrativo, por org_id). Importa itens
// planos pré-existentes (ADR-0084/0087) pro modelo User Products (ADR-0088) — só leitura remota
// (GET), nenhum POST/PUT no Mercado Livre. Disparado manualmente pelo admin da org (não é
// schedule — ao contrário do reconciliador de convergência).
//
// Candidatas e upsert via RPC (revisão adversarial, Codex): a versão anterior fazia 2 queries
// client-side (families + raízes) e calculava a diferença em JS — 3 problemas reais: (1) sem
// paginação, uma org com >1000 raízes truncaria o resultado e produziria falso "sem filho"; (2)
// múltiplas linhas históricas de `familias` por `codigo_pai` (1 por lote de UPDATE) processava a
// mesma âncora várias vezes; (3) upsert raiz+filho em 2 chamadas HTTP separadas não era atômico —
// falha no filho deixava a raiz marcada 'publicado' sem filho nenhum. As 2 RPCs (migration
// `20260723222253_adr88_backfill_rpc.sql`) resolvem os 3: NOT EXISTS no servidor (sem truncamento),
// `distinct on (codigo_pai) order by publicado_em desc` (1 candidata por âncora), 1 transação SQL
// pro upsert atômico.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarItemBackfill } from '../_shared/ml/buscar-item.ts';
import { reconciliarBackfill, type PortasBackfill, type FamiliaSemFilho } from '../_shared/user-products/reconciliar-backfill.ts';

const CANAL = 'mercado_livre';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string; let isAdmin: boolean;
  try { ({ orgId, isAdmin } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  if (!isAdmin) return new Response('Somente administradores podem executar esta ação', { status: 403, headers: corsHeaders });

  const admin = adminClient();
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const conexao = await resolverConexao(admin, orgId, CANAL);
  if (!conexao) return json({ erro: 'Organização sem conexão com o Mercado Livre' }, 400);
  const sellerEsperado = conexao.contaExternaId ?? '';

  const { data: candidatasRaw, error: candErr } = await admin
    .rpc('reconciliar_backfill_up_candidatas', { p_org_id: orgId });
  if (candErr) return json({ erro: `consultar candidatas ao backfill falhou: ${candErr.message}` }, 500);
  const semFilho: FamiliaSemFilho[] = ((candidatasRaw ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: f.familia_id as string, userId: f.user_id as string, codigoPai: f.codigo_pai as string,
    orgId, mlItemId: f.ml_item_id as string,
  }));

  const token = await getValidAccessTokenConexao(conexao);
  const portas: PortasBackfill = {
    listarFamiliasSemFilho: () => Promise.resolve(semFilho),
    buscarItem: (itemId) => buscarItemBackfill(fetch, { accessToken: token }, itemId),
    upsertRaizEFilho: async (familia, item) => {
      const { data: inserido, error } = await admin.rpc('reconciliar_backfill_up_upsert', {
        p_org_id: familia.orgId, p_user_id: familia.userId, p_codigo_pai: familia.codigoPai,
        p_ml_item_id: familia.mlItemId, p_sku: item.sku, p_status: item.status,
        p_family_id: item.familyId, p_user_product_id: item.userProductId, p_permalink: item.permalink,
      });
      if (error) throw new Error(`upsert RPC (${familia.codigoPai}/${item.sku}): ${error.message}`);
      return !!inserido;
    },
  };

  const resultado = await reconciliarBackfill(portas, sellerEsperado);
  return json({ ok: true, ...resultado });
});
