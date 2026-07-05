import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { cacheCorInvalidar } from '../_shared/redis/cache-cor.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: { codigo?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400, headers: corsHeaders });
  }
  if (!body.codigo) {
    return new Response('codigo obrigatório', { status: 400, headers: corsHeaders });
  }

  try {
    await cacheCorInvalidar(orgId, body.codigo);
    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Redis: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
