import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { parseStatusML, type ItemMLStatus } from '../_shared/ml/status.ts';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('user_id', user.id).not('ml_item_id', 'is', null);
  const ids = [...new Set((familias ?? []).map((f) => f.ml_item_id as string))];
  if (ids.length === 0) {
    return new Response(JSON.stringify({ itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let token: string;
  try { token = await getValidAccessToken(user.id); }
  catch {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Chunks em paralelo (latência O(1) em vez de O(n/20) serial).
  const respostas = await Promise.all(chunk(ids, 20).map(async (bloco) => {
    const url = `https://api.mercadolibre.com/items?ids=${bloco.join(',')}&attributes=id,status,sub_status,available_quantity,price`;
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) { console.warn(`status-publicados ML ${resp.status} (bloco)`); return []; }
      const arr = await resp.json(); // [{ code, body }]
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn('status-publicados ML falhou (bloco):', (e as Error).message);
      return [];
    }
  }));

  const porId = new Map<string, ItemMLStatus | null>();
  for (const entry of respostas.flat()) {
    const body = entry?.body;
    const id = body?.id;
    if (entry?.code === 200 && id) porId.set(id, body as ItemMLStatus);
    else if (id) porId.set(id, null);
  }

  const itens = ids.map((id) => ({ ml_item_id: id, ...parseStatusML(porId.get(id) ?? null) }));
  return new Response(JSON.stringify({ itens }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
