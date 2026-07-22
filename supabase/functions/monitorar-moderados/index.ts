import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { diffModerados, resolvidosConfirmadosDe, type ModeradoCorrente } from '../_shared/moderacao/diff.ts';
import { estenderEscopoModeracao } from '../_shared/canais/escopo-up.ts';
import { mapearConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { enviarTelegram, montarMensagemModerados, type ItemAlerta } from '../_shared/notificacoes/telegram.ts';
import { lerConfigTelegram, notificarCategoria } from '../_shared/notificacoes/config.ts';

// E7: iteração por conexão (marketplace_connections), não mais por ml_credentials.user_id.
type ConexaoComDono = ConexaoCanal & { criadoPor: string | null };
interface ConexaoRow {
  id: string; org_id: string; canal: string;
  conta_externa_id: string | null; expires_at: string | null; criado_por: string | null;
}
function mapCx(row: ConexaoRow): ConexaoComDono {
  return { ...mapearConexao(row)!, criadoPor: row.criado_por };
}

// Varre os itens publicados de uma org, registra novos moderados / recuperados e
// alerta no Telegram (se ativo). Retorna a contagem de novos.
async function processarConexao(admin: ReturnType<typeof adminClient>, conn: ReturnType<typeof getConnector>, cx: ConexaoComDono): Promise<number> {
  const orgId = cx.orgId;
  const { data: familias, error: familiasErr } = await admin.from('familias')
    .select('ml_item_id, nome_pai, ml_permalink')
    .eq('org_id', orgId).not('ml_item_id', 'is', null);
  if (familiasErr) {
    // Sem a lista de familias não dá pra distinguir "item removido" de "falha de leitura":
    // aborta para não resolver moderações por engano (tratar ausência como órfão seria perigoso).
    console.warn(`monitorar-moderados: falha ao ler familias da org ${orgId}, pulando:`, familiasErr.message);
    return 0;
  }
  const porItemFamilias = new Map<string, { nome: string | null; permalink: string | null }>();
  for (const f of familias ?? []) {
    porItemFamilias.set(f.ml_item_id as string, { nome: f.nome_pai as string | null, permalink: f.ml_permalink as string | null });
  }
  // ADR-0088 §2: itens filhos User Products (cores 2..N) da org — sem essa união, moderação
  // dessas cores fica invisível (só a 1ª cor/partição 0 está em `familias.ml_item_id`).
  const { data: itensUP } = await admin.from('anuncios_externos_itens')
    .select('item_externo_id, permalink').eq('org_id', orgId).not('item_externo_id', 'is', null);
  const porItem = estenderEscopoModeracao(
    porItemFamilias,
    (itensUP ?? []).map((i) => ({ item_externo_id: i.item_externo_id as string | null, permalink: i.permalink as string | null })),
  );
  const ids = [...porItem.keys()];

  // Status atual dos itens publicados (se houver). Sem itens, pula a leitura mas ainda fecha órfãos.
  let statusPorId: Record<string, { status: string; motivo: string | null }> = {};
  if (ids.length > 0) {
    try {
      statusPorId = await conn.lerStatus({ getToken: () => getValidAccessTokenConexao(cx) }, ids);
    } catch {
      console.warn(`monitorar-moderados: sem credencial ML p/ org ${orgId}, pulando`);
      return 0;
    }
  }

  const correntes: ModeradoCorrente[] = ids
    .filter((id) => statusPorId[id]?.status === 'moderado')
    .map((id) => ({ ml_item_id: id, status: 'moderado', motivo: statusPorId[id]?.motivo ?? null }));

  const { data: abertos } = await admin.from('ml_moderacao')
    .select('ml_item_id').eq('org_id', orgId).is('resolvido_em', null);
  const abertosLista = (abertos ?? []) as { ml_item_id: string }[];

  const resolvidosConfirmados = resolvidosConfirmadosDe(ids, statusPorId, abertosLista);
  const { novos, resolvidos } = diffModerados(correntes, abertosLista, resolvidosConfirmados);

  if (resolvidos.length > 0) {
    await admin.from('ml_moderacao')
      .update({ resolvido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq('org_id', orgId).is('resolvido_em', null).in('ml_item_id', resolvidos);
  }

  if (novos.length === 0) return 0;

  const userId = cx.criadoPor; // proxy legado: ml_moderacao.user_id ainda NOT NULL
  if (!userId) return 0;
  await admin.from('ml_moderacao').insert(
    novos.map((n) => ({ user_id: userId, org_id: orgId, ml_item_id: n.ml_item_id, status: n.status, motivo: n.motivo })),
  );

  // Alerta aos destinatários da categoria 'moderacao'; só marca alertado_em se ao menos um recebeu.
  const itensAlerta: ItemAlerta[] = novos.map((n) => ({
    ml_item_id: n.ml_item_id,
    titulo: porItem.get(n.ml_item_id)?.nome ?? null,
    motivo: n.motivo,
    permalink: porItem.get(n.ml_item_id)?.permalink ?? null,
  }));
  const enviados = await notificarCategoria(admin, orgId, 'moderacao', montarMensagemModerados(itensAlerta));
  if (enviados > 0) {
    await admin.from('ml_moderacao')
      .update({ alertado_em: new Date().toISOString() })
      .eq('org_id', orgId).is('resolvido_em', null)
      .in('ml_item_id', novos.map((n) => n.ml_item_id));
  }
  return novos.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  const admin = adminClient();

  // Dois modos de chamada:
  //  - QStash (agendado): assinatura válida → processa TODAS as conexões (todas as orgs).
  //  - Usuário logado (botões da tela): JWT válido → escopo só à própria org (E7).
  const temAssinatura = !!req.headers.get('upstash-signature');
  let scopedOrgId: string | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) {
      return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    }
  } else {
    try {
      ({ orgId: scopedOrgId } = await requireUserOrg(req));
    }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: { teste?: boolean; chatId?: string } = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio/QStash */ }

  // Ação "Enviar teste" (só usuário logado): manda uma mensagem fixa pro Telegram da org.
  // chatId opcional testa um destinatário específico (ex.: Usuários) sem depender do
  // chat_id salvo em Configurações — o bot token continua vindo sempre da config da org.
  if (payload.teste && scopedOrgId) {
    const cfg = await lerConfigTelegram(admin, scopedOrgId);
    const chatId = payload.chatId?.trim() || cfg.chatId;
    if (!cfg.token || !chatId) {
      return new Response(JSON.stringify({ ok: false, erro: 'Configure o bot token e o chat ID antes de testar.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const enviou = await enviarTelegram(cfg.token, chatId, '✅ Teste do PubliAI: alertas de moderação configurados com sucesso.');
    return new Response(JSON.stringify({ ok: enviou, erro: enviou ? undefined : 'Falha ao enviar; confira token/chat ID.' }), {
      status: enviou ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const conn = getConnector('mercado_livre');
  let query = admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por').eq('canal', 'mercado_livre');
  if (scopedOrgId) query = query.eq('org_id', scopedOrgId);
  const { data: conexoesRaw } = await query;

  let totalNovos = 0;
  for (const row of (conexoesRaw ?? []) as ConexaoRow[]) {
    try {
      totalNovos += await processarConexao(admin, conn, mapCx(row));
    } catch (e) {
      console.error(`monitorar-moderados: falhou para org ${row.org_id}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ ok: true, novos: totalNovos }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
