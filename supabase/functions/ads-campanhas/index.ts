// Aba Campanhas do /ads (emenda ADR-0179 de 2026-10-20, spike 057): leitura sob demanda, SÓ GET no ML.
// A regra vive em _shared/ads/campanhas.ts (vitest); aqui só a fiação de IO. Cache Redis de 10 min por org.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { buscarItensML, criarGetJson } from '../_shared/promocoes/ml.ts';
import { carregarCadastro, criarTarifaEm, lerAliquotas } from '../_shared/promocoes/deps.ts';
import { lerCampanhasAds, lerTodasPaginas, montarPublicados, type DepsCampanhas } from '../_shared/ads/campanhas.ts';

const TTL_S = 600;
const API = 'https://api.mercadolibre.com';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const falhou = (onde: string, e: { message: string } | null) => { if (e) throw new Error(`${onde}: ${e.message}`); };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    let orgId: string;
    try {
      ({ orgId } = await requireUserOrg(req, { access: 'read' }));
    } catch (r) {
      if (r instanceof Response) return r;
      throw r;
    }
    let fresco = false;
    try { fresco = (await req.json())?.fresco === true; } catch { /* body vazio */ }

    const admin = adminClient();
    if (!(await exigirModulo(admin, orgId, 'ads'))) return json({ ok: false, erro: 'módulo ads desligado' }, 403);

    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao?.contaExternaId) return json({ ok: true, estado: 'sem_conexao' });
    const token = await getValidAccessTokenConexao(conexao);
    const cx = { orgId, mlUserId: conexao.contaExternaId, token };

    const chave = `ads:camp:v1:${orgId}`;
    if (!fresco) {
      try {
        const hit = await redisGet(chave);
        if (hit) return json(JSON.parse(hit));
      } catch (e) { console.warn('[ads-campanhas] cache indisponível (leitura)', e); }
    }

    const deps: DepsCampanhas = {
      async get(path, headers) {
        const r = await fetch(`${API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}`, ...headers } });
        let corpo: unknown = null;
        try { corpo = await r.json(); } catch { /* não é JSON */ }
        return { status: r.status, corpo };
      },
      hoje: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
      async contarCadastro() {
        const { count, error } = await admin.from('variacoes')
          .select('id, familias!inner(ml_item_id)', { count: 'exact', head: true }).eq('org_id', orgId);
        falhou('contarCadastro', error);
        return count ?? 0;
      },
      carregarCadastro: () => carregarCadastro(admin, orgId),
      lerAliquotas: () => lerAliquotas(admin, orgId),
      buscarItensML: (ids) => buscarItensML(criarGetJson(token), ids),
      tarifaEm: criarTarifaEm(cx, { fresco }),
      async lerPublicados() {
        const pais = await lerTodasPaginas(async (de, ate) => {
          const { data, error } = await admin.from('anuncios_externos').select('id, codigo_pai, item_externo_id')
            .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('status', 'publicado')
            .not('item_externo_id', 'is', null).order('id').range(de, ate);
          falhou('publicados.pais', error);
          return data ?? [];
        });
        const filhos = await lerTodasPaginas(async (de, ate) => {
          const { data, error } = await admin.from('anuncios_externos_itens').select('anuncio_externo_id, item_externo_id')
            .eq('org_id', orgId).eq('retirado', false)
            .not('item_externo_id', 'is', null).order('id').range(de, ate);
          falhou('publicados.filhos', error);
          return data ?? [];
        });
        return montarPublicados(pais, filhos);
      },
    };

    const r = await lerCampanhasAds(deps, new Date().toISOString());
    if (r.estado === 'ok') {
      try { await redisSet(chave, JSON.stringify(r), TTL_S); } catch (e) { console.warn('[ads-campanhas] cache indisponível (escrita)', e); }
    }
    return json(r);
  } catch (e) {
    console.error('[ads-campanhas]', e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
