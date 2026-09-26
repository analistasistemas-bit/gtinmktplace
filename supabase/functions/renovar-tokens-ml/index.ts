// ADR-0171 — renova proativamente conexões `mercado_livre` com token perto de vencer (< 165 min),
// fora da virada da hora onde `sincronizar-promocoes`, `pulse-coletar`, `monitorar-moderados`,
// `reconciliar-faturamento` e `reconciliar-convergencia-up` se concentram e disputam o rate limit
// de refresh do ML (por app/client_id). Schedule QStash `40 * * * *`. Casca fina: só valida a
// assinatura e delega o miolo (processar.ts, deps injetadas, testável).
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { renovarTokenConexao } from '../_shared/ml/token.ts';
import { processarRenovacao, LIMITE_RENOVACAO_MS, type ResumoRenovacao } from './processar.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  let resumo: ResumoRenovacao;
  try {
    resumo = await processarRenovacao({
      listarConexoesAExpirar: async () => {
        const agora = new Date();
        const limite = new Date(agora.getTime() + LIMITE_RENOVACAO_MS);
        const { data, error } = await admin.from('marketplace_connections')
          .select('id, org_id, canal, conta_externa_id, expires_at')
          .eq('canal', 'mercado_livre')
          .not('expires_at', 'is', null)
          .gt('expires_at', agora.toISOString())
          .lt('expires_at', limite.toISOString())
          .order('expires_at', { ascending: true });
        if (error) throw new Error(`marketplace_connections: ${error.message}`);
        return (data ?? []).map((row) => mapearConexao(row)!);
      },
      renovar: renovarTokenConexao,
      sleep,
    });
  } catch (e) {
    // Falha ao listar (banco fora do ar etc.): loga e responde 200 vazio — não é a rotina de
    // refresh do ML (essa segue protegida por conexão dentro de processarRenovacao), então não
    // há razão pro QStash martelar /oauth/token retentando a rodada inteira.
    console.error('[renovar-tokens-ml] falha ao listar conexões', e instanceof Error ? e.message : e);
    resumo = { ok: true, renovadas: 0, puladas: 0, falhas: 0, interrompido_429: false };
  }

  return new Response(JSON.stringify(resumo), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
