// Sonar — visitas 30d por anúncio (ADR-0127/D3): edge fina, par da pulse-sonar-vendas. 1 chamada
// /items/{id}/visits/time_window por item (funciona para terceiros — 20/20 HTTP 200, medido
// 19/08), cache global POR ITEM (dado público, ADR-0120 §3). Só leitura no ML.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { redisGet, redisSet } from '../_shared/redis/client.ts';
import { parseVisitasJanela, validarItemIds, type VisitasJanela } from '../_shared/pulse/sonar.ts';

const API = 'https://api.mercadolibre.com';
// 24h, não 7d: a janela de 30 dias anda todo dia — TTL maior serviria visita velha (D6).
const CACHE_TTL_S = 24 * 60 * 60;
const LOTE_CONCORRENCIA = 5; // mesmo teto da pulse-sonar antiga, para não estourar rate limit do ML

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function visitasDoItem(itemId: string, token: string): Promise<VisitasJanela | null> {
  const chave = `sonar:visitas:v1:${itemId}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado);
  const resp = await mlGet(`${API}/items/${itemId}/visits/time_window?last=30&unit=day`, token);
  const visitas = parseVisitasJanela(resp);
  // Falha (null) NÃO cacheia — erro transitório não pode travar o item por 24h.
  // total 0 com HTTP 200 é ZERO MEDIDO e cacheia normal (D8).
  if (visitas != null) await redisSet(chave, JSON.stringify(visitas), CACHE_TTL_S).catch(() => {});
  return visitas;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req, { access: 'read' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { item_ids?: unknown };
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const itemIds = validarItemIds(body.item_ids);
  if (itemIds == null) return json({ erro: 'item_ids obrigatório (1 a 20 strings)' }, 400);

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  // Sem conexão ML → indisponível explícito com 200 (mesmo padrão do configurado:false da
  // vendas): a coluna Visitas mostra "—" e o resto da tela vive (D16, único modo degradado).
  if (!conexao) return json({ conectado: false });
  const token = await getValidAccessTokenConexao(conexao);

  const porItem: Record<string, VisitasJanela | null> = {};
  for (let i = 0; i < itemIds.length; i += LOTE_CONCORRENCIA) {
    const lote = itemIds.slice(i, i + LOTE_CONCORRENCIA);
    const settled = await Promise.allSettled(lote.map((id) => visitasDoItem(id, token)));
    settled.forEach((s, j) => { porItem[lote[j]] = s.status === 'fulfilled' ? s.value : null; });
  }
  return json({ conectado: true, por_item: porItem });
});
