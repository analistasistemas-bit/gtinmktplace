// ADR-0088 — Reconciliador de CONVERGÊNCIA (schedule QStash, espelha reconciliar-faturamento):
// retoma famílias User Products travadas em `mudando_composicao=true` (mudança de composição
// interrompida por crash) reusando a mini-saga já existente (`atualizarFamiliaUP`) — NÃO
// reimplementa composição/agregação, só re-dispara com um claim atômico por cima.
//
// Escopo desta entrega: só o caso `mudando_composicao=true` (o citado pela própria ADR como "o
// reconciliador" no passo 8 da saga e na mini-saga de composição). `estado_desejado='ativando'`
// (compensacao_pendente da saga de CRIAÇÃO) fica de fora — hoje esse caso já converge via
// "Reenviar" manual; automatizá-lo exigiria reconstruir o `AnuncioCanonico` completo dentro do
// reconciliador (fotos, desconto, dimensões, listing_type). `estado_desejado='pausando'` não tem
// produtor no código hoje. Ver docs/TASKS.md.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { processarConvergencia } from './processar.ts';

// Janela anti-corrida: só LISTA raízes cujo `atualizado_em` já passou desse tempo (dá espaço pro
// worker normal do UPDATE resolver sozinho primeiro). O claim atômico (RPC) faz a re-checagem REAL
// logo antes de agir — esta janela só reduz quantas raízes chegam a tentar o claim, não é ela quem
// garante exclusão mútua (isso é o WHERE dentro da própria RPC — ver comentário na migration).
const JANELA_ANTI_CORRIDA_MS = 15 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  let resultados;
  try {
    resultados = await processarConvergencia(admin, JANELA_ANTI_CORRIDA_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('reconciliar-convergencia-up: falhou:', msg);
    return new Response(JSON.stringify({ erro: msg }), { status: 500, headers: corsHeaders });
  }

  const resumo = {
    total: resultados.length,
    convergiram: resultados.filter((r) => r.tipo === 'convergiu').length,
    retry: resultados.filter((r) => r.tipo === 'retry').length,
    erro: resultados.filter((r) => r.tipo === 'erro').length,
    perderamClaim: resultados.filter((r) => r.tipo === 'perdeu_claim').length,
  };
  return new Response(JSON.stringify({ ok: true, ...resumo }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
