// ADR-0135: casca fina. Valida a assinatura do QStash e delega o miolo,
// que vive em processar.ts com dependências injetadas para ser testável.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, type SincronizarFiscalJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { empurrarFiscalSku, lerCanInvoice, vincularSkuAnuncio } from '../_shared/canais/fiscal-ml.ts';
import { listarItensUP } from '../_shared/fiscal/can-invoice.ts';
import { processarSincronizacaoFiscal } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: SincronizarFiscalJob;
  try { job = JSON.parse(body); }
  catch { return new Response('Body inválido', { status: 400, headers: corsHeaders }); }

  const r = await processarSincronizacaoFiscal({
    admin: adminClient(),
    resolverConexao,
    getToken: (cx) => getValidAccessTokenConexao(cx as never),
    // Fix round 3 (Q1): erro de leitura nunca vira decisão definitiva — lança (padrão de
    // vincular-catalogo/vinculacao.ts), processar.ts converte em 500 pro QStash retentar.
    listarVariacoes: async (admin, familiaId) => {
      const { data, error } = await admin.from('variacoes')
        .select('codigo, gtin, peso_gramas, ml_variation_id')
        .eq('familia_id', familiaId).eq('excluida_da_publicacao', false);
      if (error) throw new Error(`listarVariacoes: ${error.message}`);
      return data ?? [];
    },
    // C1: filhos User Products (ADR-0088) — Task 8 extraiu pra _shared/fiscal/can-invoice.ts,
    // reusado também pela reconciliação de monitorar-moderados.
    listarItensUP,
    portas: { empurrarFiscalSku, vincularSkuAnuncio, lerCanInvoice },
  }, job);
  return new Response(
    typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
