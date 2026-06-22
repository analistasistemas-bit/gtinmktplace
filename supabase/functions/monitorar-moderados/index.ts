import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { diffModerados, type ModeradoCorrente } from '../_shared/moderacao/diff.ts';
import { enviarTelegram, montarMensagemModerados, type ItemAlerta } from '../_shared/notificacoes/telegram.ts';

interface ConfigTelegram { token: string | null; chatId: string | null; ativo: boolean }

async function lerConfigTelegram(admin: ReturnType<typeof adminClient>, userId: string): Promise<ConfigTelegram> {
  const { data } = await admin.from('configuracoes')
    .select('telegram_bot_token, telegram_chat_id, telegram_ativo')
    .eq('user_id', userId).maybeSingle();
  return {
    token: (data?.telegram_bot_token as string | null) ?? null,
    chatId: (data?.telegram_chat_id as string | null) ?? null,
    ativo: Boolean(data?.telegram_ativo),
  };
}

// Varre os itens publicados de um usuário, registra novos moderados / recuperados e
// alerta no Telegram (se ativo). Retorna a contagem de novos.
async function processarUsuario(admin: ReturnType<typeof adminClient>, conn: ReturnType<typeof getConnector>, userId: string): Promise<number> {
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id, nome_pai, ml_permalink')
    .eq('user_id', userId).not('ml_item_id', 'is', null);
  const porItem = new Map<string, { nome: string | null; permalink: string | null }>();
  for (const f of familias ?? []) {
    porItem.set(f.ml_item_id as string, { nome: f.nome_pai as string | null, permalink: f.ml_permalink as string | null });
  }
  const ids = [...porItem.keys()];
  if (ids.length === 0) return 0;

  let statusPorId;
  try {
    statusPorId = await conn.lerStatus({ getToken: () => getValidAccessToken(userId) }, ids);
  } catch {
    console.warn(`monitorar-moderados: sem credencial ML p/ ${userId}, pulando`);
    return 0;
  }

  const correntes: ModeradoCorrente[] = ids
    .filter((id) => statusPorId[id]?.status === 'moderado')
    .map((id) => ({ ml_item_id: id, status: 'moderado', motivo: statusPorId[id]?.motivo ?? null }));

  const { data: abertos } = await admin.from('ml_moderacao')
    .select('ml_item_id').eq('user_id', userId).is('resolvido_em', null);

  const { novos, resolvidos } = diffModerados(correntes, (abertos ?? []) as { ml_item_id: string }[]);

  if (resolvidos.length > 0) {
    await admin.from('ml_moderacao')
      .update({ resolvido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
      .eq('user_id', userId).is('resolvido_em', null).in('ml_item_id', resolvidos);
  }

  if (novos.length === 0) return 0;

  await admin.from('ml_moderacao').insert(
    novos.map((n) => ({ user_id: userId, ml_item_id: n.ml_item_id, status: n.status, motivo: n.motivo })),
  );

  // Alerta no Telegram só se ativo e com credenciais; só marca alertado_em se enviou.
  const cfg = await lerConfigTelegram(admin, userId);
  if (cfg.ativo) {
    const itensAlerta: ItemAlerta[] = novos.map((n) => ({
      ml_item_id: n.ml_item_id,
      titulo: porItem.get(n.ml_item_id)?.nome ?? null,
      motivo: n.motivo,
      permalink: porItem.get(n.ml_item_id)?.permalink ?? null,
    }));
    const enviou = await enviarTelegram(cfg.token, cfg.chatId, montarMensagemModerados(itensAlerta));
    if (enviou) {
      await admin.from('ml_moderacao')
        .update({ alertado_em: new Date().toISOString() })
        .eq('user_id', userId).is('resolvido_em', null)
        .in('ml_item_id', novos.map((n) => n.ml_item_id));
    }
  }
  return novos.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  const admin = adminClient();

  // Dois modos de chamada:
  //  - QStash (agendado): assinatura válida → processa TODOS os usuários.
  //  - Usuário logado (botões da tela): JWT válido → escopo só ao próprio usuário.
  const temAssinatura = !!req.headers.get('upstash-signature');
  let scopedUserId: string | null = null;
  if (temAssinatura) {
    if (!(await verificarAssinatura(req, body))) {
      return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    }
  } else {
    try { scopedUserId = (await requireUser(req)).id; }
    catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  }

  let payload: { teste?: boolean } = {};
  try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio/QStash */ }

  // Ação "Enviar teste" (só usuário logado): manda uma mensagem fixa pro Telegram dele.
  if (payload.teste && scopedUserId) {
    const cfg = await lerConfigTelegram(admin, scopedUserId);
    if (!cfg.token || !cfg.chatId) {
      return new Response(JSON.stringify({ ok: false, erro: 'Configure o bot token e o chat ID antes de testar.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const enviou = await enviarTelegram(cfg.token, cfg.chatId, '✅ Teste do PubliAI: alertas de moderação configurados com sucesso.');
    return new Response(JSON.stringify({ ok: enviou, erro: enviou ? undefined : 'Falha ao enviar; confira token/chat ID.' }), {
      status: enviou ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const conn = getConnector('mercado_livre');
  let userIds: string[];
  if (scopedUserId) {
    userIds = [scopedUserId];
  } else {
    const { data: contas } = await admin.from('ml_credentials').select('user_id');
    userIds = (contas ?? []).map((c) => c.user_id as string);
  }

  let totalNovos = 0;
  for (const userId of userIds) {
    totalNovos += await processarUsuario(admin, conn, userId);
  }

  return new Response(JSON.stringify({ ok: true, novos: totalNovos }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
