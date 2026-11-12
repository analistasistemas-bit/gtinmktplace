// ADR-0201 (Galeria da cor por IA), Task 14: worker da saga de aplicar/reverter. Só QStash (verify_jwt = false +
// assinatura). Recebe os jobs de item que o despachante (e o `galeria-aplicar`, como otimização) publica SEMPRE na fila
// serial `publish-ml-${familias.user_id}` — {tipo:'aplicacao_item'|'aplicacao_foto', id, fase, ...} — e executa UMA
// fase decidida pela linha (lógica em _shared/galeria/saga.ts). Nunca publica nada. `ocupado`/`ignorar` = 200.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { executarItem } from '../_shared/galeria/saga.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const texto = await req.text();
  if (!(await verificarAssinatura(req, texto))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let m: Record<string, unknown>;
  try { m = JSON.parse(texto); } catch { return json({ error: 'mensagem_invalida' }, 400); }
  if (!['aplicacao_item', 'aplicacao_foto'].includes(m?.tipo as string) || typeof m.id !== 'string' || !Number.isInteger(m.fase)) {
    return json({ error: 'mensagem_invalida' }, 400);
  }
  const admin = adminClient();
  const t0 = Date.now();
  try {
    const resultado = await executarItem(admin, { id: m.id, fase: m.fase as number }, {
      agora: () => new Date(),
      token: async (orgId) => {
        const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
        if (!cx) throw new Error('sem_conexao_ml');
        return getValidAccessTokenConexao(cx);
      },
    });
    // ADR-0201 (k): a mensagem de envio sobe várias fotos; o tempo vai ao log para medir no primeiro teste real.
    console.log('[galeria-aplicar-worker]', m.id, resultado, `${Date.now() - t0}ms`);
    return json({ ok: true, resultado });
  } catch (e) {
    console.error('[galeria-aplicar-worker]', m.id, (e as Error).message);
    return json({ ok: false }, 500);
  }
});
