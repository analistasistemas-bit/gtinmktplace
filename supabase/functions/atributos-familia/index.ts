import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { atributosFaltantesGenerico, type AtributoML } from '../_shared/categoria/atributos.ts';
import { faltantesEditaveis, validarValorAtributo } from '../_shared/categoria/faltantes-editaveis.ts';

// Camada 2B (ADR-0052): fallback manual de atributos na Revisão. Lista os obrigatórios faltantes
// COM schema (tipo/valores) e salva um valor validando server-side, fazendo merge em atributos_ml,
// marcando a flag de edição manual e recalculando atributos_faltantes. RLS via userClient(jwt).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Missing auth', { status: 401, headers: corsHeaders });

  const sb = userClient(auth.slice(7));
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  let body: { action?: string; familia_id?: string; atributo_id?: string; valor?: string };
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.familia_id) return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });

  // RLS garante que só famílias visíveis ao usuário são lidas/escritas.
  const { data: familia, error } = await sb.from('familias')
    .select('id, categoria_ml_id, atributos_ml, user_id').eq('id', body.familia_id).maybeSingle();
  if (error || !familia) return new Response('Família não encontrada', { status: 404, headers: corsHeaders });
  if (!familia.categoria_ml_id) return new Response('Família sem categoria', { status: 400, headers: corsHeaders });

  const token = await getValidAccessToken(familia.user_id);
  const schema = await lerSchemaAtributos(token, familia.categoria_ml_id);
  const atuais = (familia.atributos_ml as AtributoML[] | null) ?? [];

  if (body.action === 'faltantes') {
    return new Response(JSON.stringify({ campos: faltantesEditaveis(schema, atuais) }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  if (body.action === 'salvar') {
    if (!body.atributo_id || body.valor == null) {
      return new Response('atributo_id e valor obrigatórios', { status: 400, headers: corsHeaders });
    }
    const validado = validarValorAtributo(schema, body.atributo_id, body.valor);
    if (!validado) return new Response('Valor inválido para o atributo', { status: 422, headers: corsHeaders });
    const merged = [...atuais.filter((a) => a.id !== validado.id), validado];
    const faltantes = atributosFaltantesGenerico(merged, schema);
    const { error: upErr } = await sb.from('familias')
      .update({ atributos_ml: merged, atributos_faltantes: faltantes, atributos_editados_pelo_operador: true })
      .eq('id', familia.id);
    if (upErr) return new Response(`Erro ao salvar: ${upErr.message}`, { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true, atributos_faltantes: faltantes }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } });
  }

  return new Response('action inválida', { status: 400, headers: corsHeaders });
});
