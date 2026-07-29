// E6b (ADR-0094, D-12): rede de segurança do PUSH — não do WEBHOOK.
//
// ESCOPO DELIBERADAMENTE ESTREITO: só re-empurra produtos que TÊM movimento no ledger
// (outbox pendente ou movimento recente). Um re-push "preventivo" de produto SEM
// movimento seria ativamente perigoso: webhook perdido significa que a venda nunca
// baixou e o saldo local está ALTO DEMAIS; empurrar esse saldo para todos os canais
// — inclusive aquele onde a venda ocorreu — RESTAURARIA unidades já vendidas e
// ampliaria o oversell. Recuperar webhook perdido exige importar o pedido faltante e
// aplicar a baixa; isso NÃO existe hoje e está registrado como fora de escopo.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarSincronizacaoEstoque } from '../_shared/queue.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { lerPushPendente, despacharPushPendente } from '../_shared/estoque/baixa.ts';

/** Teto operacional por execução: 5 páginas × 200 = 1.000 movimentos por org. */
const MAX_PAGINAS = 5;
const TAMANHO_PAGINA = 200;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // PAGINAÇÃO OBRIGATÓRIA: o PostgREST trunca em ~1000 linhas. Sem isto a
  // reconciliação ignoraria movimentos em silêncio.

  // (a) Produtos com movimento nas últimas 24h.
  const movs = await paginarTudo<{ org_id: string; codigo_pai: string }>(
    (de, ate) => admin.from('estoque_movimentos')
      .select('org_id, codigo_pai').gte('criado_em', desde).neq('codigo_pai', '').range(de, ate),
  );

  // (b) Outbox: movimento aplicado cujo push nunca foi entregue, de qualquer idade.
  const pendentes = await paginarTudo<{ org_id: string; codigo_pai: string }>(
    (de, ate) => admin.from('estoque_movimentos')
      .select('org_id, codigo_pai')
      .is('push_enfileirado_em', null).neq('codigo_pai', '').range(de, ate),
  );

  // 1) OUTBOX: drena pelo MESMO dispatcher do sync-venda, para que a intenção de
  //    propagação venha do movimento e o `push_enfileirado_em` seja de fato marcado.
  const orgsComPendencia = new Set(pendentes.map((m) => m.org_id));
  let drenados = 0;
  for (const orgId of orgsComPendencia) {
    try {
      // Drena em páginas, mas PARA no primeiro sinal de falha ou de não-progresso.
      // Sem isso, uma falha persistente faria o laço reler os mesmos pendentes e
      // repetir a chamada remota N vezes na mesma execução.
      for (let volta = 0; volta < MAX_PAGINAS; volta++) {
        const pagina = await lerPushPendente(admin, orgId, TAMANHO_PAGINA);
        if (pagina.length === 0) break;
        const r = await despacharPushPendente(admin, orgId, pagina, enfileirarSincronizacaoEstoque);
        drenados += r.marcados;
        if (r.falhas > 0 || r.marcados === 0) {
          console.error('reconciliar_outbox_interrompido', { orgId, ...r });
          break;
        }
        // Teto atingido com a página ainda cheia: sobrou backlog. Logar em vez de
        // truncar em silêncio.
        if (volta === MAX_PAGINAS - 1 && pagina.length === TAMANHO_PAGINA) {
          console.warn('reconciliar_outbox_backlog', { orgId, teto: MAX_PAGINAS * TAMANHO_PAGINA });
        }
      }
    } catch (e) {
      console.error('reconciliar_outbox_falhou', orgId, e);   // uma org nunca bloqueia outra
    }
  }

  // 2) Re-push dos produtos com movimento recente JÁ DESPACHADO. Cobre o caso em que o
  //    job foi enfileirado mas o push falhou em definitivo no canal. O saldo aqui é
  //    fresco — houve movimento —, então empurrar para todos os canais é seguro.
  //    Pendentes ficam FORA: já foram tratados no passo 1 com a intenção correta.
  const chavesPendentes = new Set(pendentes.map((m) => `${m.org_id}|${m.codigo_pai}`));
  const alvos = new Set<string>();
  for (const m of movs) {
    const chave = `${m.org_id}|${m.codigo_pai}`;
    if (!chavesPendentes.has(chave)) alvos.add(chave);
  }

  let enfileirados = 0;
  for (const chave of alvos) {
    const [orgId, codigoPai] = chave.split('|');
    try {
      await enfileirarSincronizacaoEstoque(
        { org_id: orgId, codigo_pai: codigoPai, canal_origem: null }, orgId,
      );
      enfileirados++;
    } catch (e) {
      console.error('reconciliar_estoque_enfileirar_falhou', orgId, codigoPai, e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, drenados, enfileirados, avaliados: alvos.size }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
