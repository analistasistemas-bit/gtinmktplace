// ADR-0201 (Galeria da cor por IA), Task 8: relógio da galeria. Só QStash (agendamento de 1 min, verify_jwt = false +
// assinatura). Cada execução recomeça pela cabeça das consultas (sem cursor): imagens a submeter/consultar, visão
// pendente, itens e ações de aplicação, e escritas adiadas dos escritores comuns. Lógica em _shared/galeria/despacho.ts.
// Nunca escreve no ML.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarJobPublicacaoML, garantirFilaSerial, qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { despachar } from '../_shared/galeria/despacho.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  // Sem APP_URL o aviso seria gravado sem link para sempre: pula (o despacho segue) e avisa no log.
  const appUrl = Deno.env.get('APP_URL')?.trim() || undefined;
  if (!appUrl) console.error('[galeria-despachante] APP_URL ausente: aviso de imagens prontas pulado');
  try {
    const r = await despachar(adminClient(), {
      agora: new Date(),
      base: Deno.env.get('SUPABASE_URL')!,
      publicar: (msgs) => qstashClient().batchJSON(msgs as never) as never,
      garantirFila: garantirFilaSerial,
      enfileirar: enfileirarJobPublicacaoML,
      appUrl,
    });
    return new Response(JSON.stringify({ ok: true, ...r }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[galeria-despachante]', (e as Error).message);
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
