// Confronta os anúncios VIVOS da conta no ML com tudo que o PubliAI conhece e devolve os que o app
// não conhece — os "órfãos" (incidente 2026-09-10, adendo do ADR-0088: um anúncio criado pelo app e
// depois apagado do banco continuou ativo e vendendo, sem nada no sistema sabendo dele).
//
// SOMENTE LEITURA: nenhuma escrita no ML e nenhuma no banco. Sob demanda (o operador clica) e 1×/dia
// pelo QStash (aviso ao dono, ver `modoAgendado`) — cada execução são ~1 chamada por 100 anúncios
// mais o multiget.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { resolverConexao, resolverConexaoEstrita, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { verificarAssinatura, qstashClient } from '../_shared/queue.ts';
import { enfileirarEmBlocos } from '../_shared/enfileirar-em-blocos.ts';
import { enviarTelegram } from '../_shared/notificacoes/telegram.ts';
import { montarAlertaOrfaos, type OrfaoBruto } from './alerta.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { listarIdsDoSeller, detalharItens, classificar } from '../_shared/ml/varrer-itens.ts';
import { paginarTudo } from '../_shared/pagina.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/**
 * Todos os ids de anúncio que o PubliAI conhece nesta org, das 4 fontes que os guardam.
 *
 * PAGINADO, e isso é o ponto: o PostgREST corta em ~1000 linhas SEM avisar, e tanto `familias`
 * (uma linha por ciclo de UPDATE) quanto `anuncios_externos_itens` (uma por SKU) passam disso numa
 * org madura. A linha 1001 viraria "id desconhecido" e o anúncio legítimo apareceria como órfão —
 * fail-OPEN travestido de fail-closed (achado da revisão do Fable). `paginarTudo` também lança em
 * erro de página, então uma fonte incompleta derruba a varredura em vez de inventar órfão.
 */
async function idsConhecidos(admin: ReturnType<typeof adminClient>, orgId: string): Promise<Set<string>> {
  const conhecidos = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v) conhecidos.add(v); };

  // Escritas uma a uma (e não num laço sobre nomes de tabela) porque `select` com string dinâmica
  // apaga a inferência do supabase-js e o tipo do retorno vira `GenericStringError[]`.
  const familias = await paginarTudo<{ ml_item_id: string | null }>((de, ate) =>
    admin.from('familias').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null).range(de, ate));
  for (const l of familias) add(l.ml_item_id);

  const externos = await paginarTudo<{ item_externo_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null).range(de, ate));
  for (const l of externos) add(l.item_externo_id);

  const itens = await paginarTudo<{ item_externo_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos_itens').select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null).range(de, ate));
  for (const l of itens) add(l.item_externo_id);

  const kits = await paginarTudo<{ ml_item_id: string | null }>((de, ate) =>
    admin.from('kits_virtuais').select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null).range(de, ate));
  for (const l of kits) add(l.ml_item_id);

  // ANÚNCIO DE CATÁLOGO (ADR-0021 / ADR-0088 F2). O ML cria um item PRÓPRIO, com MLB próprio, a
  // partir do anúncio do app — herdando inclusive o `seller_custom_field`. Sem estas duas fontes a
  // varredura acusa como "órfão" todo anúncio de catálogo saudável da conta: foi o falso alarme de
  // 2026-09-10, em que 10 de 13 "fantasmas" eram catálogo `vinculado`. `catalog_product_id` NÃO
  // entra: é id de FICHA, não de anúncio.
  const catalogoLegacy = await paginarTudo<{ catalog_listing_id: string | null }>((de, ate) =>
    admin.from('variacoes').select('catalog_listing_id, familias!inner(org_id)')
      .eq('familias.org_id', orgId).not('catalog_listing_id', 'is', null).range(de, ate));
  for (const l of catalogoLegacy) add(l.catalog_listing_id);

  const catalogoUP = await paginarTudo<{ catalog_listing_id: string | null }>((de, ate) =>
    admin.from('anuncios_externos_itens').select('catalog_listing_id').eq('org_id', orgId)
      .not('catalog_listing_id', 'is', null).range(de, ate));
  for (const l of catalogoUP) add(l.catalog_listing_id);

  // Migração para preço por variação (ADR-0161): o item antigo normalmente vira `closed`, mas uma
  // migração parada em `_pending` deixa ele ATIVO — e ele é conhecido, não órfão.
  const anteriores = await paginarTudo<{ ml_item_id_anterior: string | null }>((de, ate) =>
    admin.from('anuncios_externos').select('ml_item_id_anterior').eq('org_id', orgId)
      .not('ml_item_id_anterior', 'is', null).range(de, ate));
  for (const l of anteriores) add(l.ml_item_id_anterior);

  return conhecidos;
}

/** A varredura em si (mesmo JSON que o app sempre recebeu). Lança em falha do ML/banco. */
async function varrer(admin: ReturnType<typeof adminClient>, conexao: ConexaoCanal, orgId: string) {
  const token = await getValidAccessTokenConexao(conexao);
  const sellerId = conexao.contaExternaId!;

  // Só `active` e `paused`: anúncio encerrado não vende e listá-lo encheria a varredura de
  // histórico — além de estourar o teto de 1000 do search em conta antiga.
  const [ativos, pausados] = await Promise.all([
    listarIdsDoSeller(fetch, token, sellerId, 'active'),
    listarIdsDoSeller(fetch, token, sellerId, 'paused'),
  ]);
  const truncado = ativos.truncado || pausados.truncado;
  const todos = [...new Set([...ativos.ids, ...pausados.ids])];

  const conhecidos = await idsConhecidos(admin, orgId);
  const desconhecidos = todos.filter((id) => !conhecidos.has(id));
  if (desconhecidos.length === 0) return { sem_detalhe: 0, orfaos: [] as OrfaoBruto[], total_no_ml: todos.length, truncado };

  const detalhes = await detalharItens(fetch, token, desconhecidos);
  return {
    // `detalharItens` descarta entradas com erro (500/429 dentro do 200 do multiget): o agendado usa
    // isso para não confirmar "zero divergências" com um item desconhecido sem detalhe.
    sem_detalhe: desconhecidos.length - detalhes.length,
    orfaos: detalhes.map((i) => ({
      ml_item_id: i.id, titulo: i.titulo, status: i.status,
      permalink: i.permalink, estoque: i.estoque, sku: i.sku,
      classe: classificar(i),
      // Pausado com código do app é, quase sempre, resultado ESPERADO de "Remover" — que pausa no
      // ML e zera o vínculo de propósito (remover-publicado). Marcar aqui evita que a tela
      // apresente como pendência algo que o próprio operador mandou fazer.
      provavel_remocao_pelo_app: i.status === 'paused' && classificar(i) === 'perdido_do_app',
    })),
    total_no_ml: todos.length,
    truncado,
  };
}

/**
 * Modo QStash (schedule diário `0 11 * * *`, 08:00 BRT). Corpo vazio → 1 job `{ orgId }` por org com
 * conexão ML (fan-out por org, ADR-0173). `{ orgId }` → varre e avisa SÓ o dono do SaaS no Telegram
 * (bot da Daludi) quando há anúncio que saiu do app. Sem divergência, silêncio. Avisa todo dia
 * enquanto a divergência existir (decisão do Diego, 2026-11-16 — sem tabela de "já avisados").
 */
async function modoAgendado(admin: ReturnType<typeof adminClient>, body: string): Promise<Response> {
  let job: { orgId?: string };
  try { job = body.trim() ? JSON.parse(body) : {}; } catch { return json({ error: 'Bad JSON' }, 400); }

  if (!job.orgId) {
    const conexoes = await paginarTudo<{ org_id: string }>((de, ate) =>
      admin.from('marketplace_connections').select('org_id').eq('canal', 'mercado_livre')
        .not('conta_externa_id', 'is', null).order('org_id').range(de, ate));
    const orgs = [...new Set(conexoes.map((c) => c.org_id))];
    const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/varrer-anuncios-orfaos`;
    await enfileirarEmBlocos(orgs, (orgId) => ({
      url, body: { orgId }, retries: 3, deduplicationId: `orfaos-diario-${orgId}-${dia}`,
    }), (msgs) => qstashClient().batchJSON(msgs));
    return json({ ok: true, publicados: orgs.length });
  }

  const orgId = job.orgId;
  try {
    // Estrita: erro de leitura lança (→ 500/retry) em vez de virar "sem conexão" silencioso.
    const conexao = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    // Conexão sumiu entre o fan-out e o job: nada a varrer, e retry não muda isso.
    if (!conexao?.contaExternaId) return json({ ok: true, sem_conexao: true });

    const r = await varrer(admin, conexao, orgId);
    // ponytail: item persistentemente sem detalhe esgota os 3 retries e fica só no log.
    if (r.sem_detalhe > 0) throw new Error(`${r.sem_detalhe} anúncio(s) desconhecido(s) sem detalhe no multiget`);
    const { data: org } = await admin.from('organizations').select('nome').eq('id', orgId).maybeSingle();
    const texto = montarAlertaOrfaos((org?.nome as string | undefined) ?? orgId, r);
    if (!texto) return json({ ok: true, divergencias: 0 });
    const enviado = await enviarTelegram(
      Deno.env.get('TELEGRAM_BOT_TOKEN') ?? null,
      Deno.env.get('TELEGRAM_LEADS_CHAT_ID') ?? null,
      texto,
    );
    // ponytail: mensagem > 4096 chars vai em partes; retry após falha parcial repete as já entregues
    // (aviso duplicado, inofensivo). Controlar progresso só se isso incomodar na prática.
    if (!enviado) return json({ ok: false, error: 'Falha ao enviar o Telegram' }, 500);
    return json({ ok: true, avisado: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ fn: 'varrer-anuncios-orfaos', modo: 'agendado', orgId, erro: msg }));
    return json({ ok: false, error: msg }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const admin = adminClient();
  // verify_jwt=false (como monitorar-moderados): QStash assina; o app manda JWT, validado à mão.
  if (req.headers.get('upstash-signature')) {
    const body = await req.text();
    if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    return modoAgendado(admin, body);
  }

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return json({ error: 'Organização sem conexão com o Mercado Livre.' }, 400);

  try {
    const { sem_detalhe: _semDetalhe, ...resposta } = await varrer(admin, conexao, orgId);
    return json(resposta);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('varrer-anuncios-orfaos falhou:', msg);
    return json({ error: `Não foi possível varrer os anúncios: ${msg}` }, 502);
  }
});
