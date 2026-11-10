// ADR-0201 (Galeria da cor por IA), Task 9: worker de geração. Só QStash (verify_jwt = false + assinatura). Recebe a
// mensagem que `publicarJobs` (despachante e galeria-gerar) publica — {tipo:'imagem', id, fase, tentativa,
// despacho_seq, acao} — e executa UMA fase decidida pela linha (lógica em _shared/galeria/worker-estado.ts). Nunca
// publica nada: o despachante encontra a próxima ação. Nunca cobra (a cobrança é da exibição). `ocupado`/`ignorar` = 200.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { executarImagem } from '../_shared/galeria/worker-estado.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const texto = await req.text();
  if (!(await verificarAssinatura(req, texto))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let m: Record<string, unknown>;
  try { m = JSON.parse(texto); } catch { return json({ error: 'mensagem_invalida' }, 400); }
  if (m?.tipo !== 'imagem' || typeof m.id !== 'string' || !Number.isInteger(m.fase) || !Number.isInteger(m.tentativa)) {
    return json({ error: 'mensagem_invalida' }, 400);
  }
  try {
    const resultado = await executarImagem(adminClient(), { id: m.id, fase: m.fase as number, tentativa: m.tentativa as number },
      { agora: () => new Date() });
    return json({ ok: true, resultado });
  } catch (e) {
    console.error('[galeria-worker]', m.id, (e as Error).message);
    return json({ ok: false }, 500);
  }
});
