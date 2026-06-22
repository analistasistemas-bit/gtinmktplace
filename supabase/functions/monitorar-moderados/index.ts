import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { diffModerados, type ModeradoCorrente } from '../_shared/moderacao/diff.ts';
import { enviarTelegram, montarMensagemModerados, type ItemAlerta } from '../_shared/notificacoes/telegram.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const conn = getConnector('mercado_livre');

  const { data: contas } = await admin.from('ml_credentials').select('user_id');
  let totalNovos = 0;

  for (const conta of contas ?? []) {
    const userId = conta.user_id as string;

    // Itens publicados desse usuário (ml_item_id + dados p/ a mensagem).
    const { data: familias } = await admin.from('familias')
      .select('ml_item_id, nome_pai, ml_permalink')
      .eq('user_id', userId).not('ml_item_id', 'is', null);
    const porItem = new Map<string, { nome: string | null; permalink: string | null }>();
    for (const f of familias ?? []) {
      porItem.set(f.ml_item_id as string, { nome: f.nome_pai as string | null, permalink: f.ml_permalink as string | null });
    }
    const ids = [...porItem.keys()];
    if (ids.length === 0) continue;

    // Status ao vivo (mesma leitura da tela). Falha de credencial → pula o usuário.
    let statusPorId;
    try {
      statusPorId = await conn.lerStatus({ getToken: () => getValidAccessToken(userId) }, ids);
    } catch {
      console.warn(`monitorar-moderados: sem credencial ML p/ ${userId}, pulando`);
      continue;
    }

    const correntes: ModeradoCorrente[] = ids
      .filter((id) => statusPorId[id]?.status === 'moderado')
      .map((id) => ({ ml_item_id: id, status: 'moderado', motivo: statusPorId[id]?.motivo ?? null }));

    const { data: abertos } = await admin.from('ml_moderacao')
      .select('ml_item_id').eq('user_id', userId).is('resolvido_em', null);

    const { novos, resolvidos } = diffModerados(correntes, (abertos ?? []) as { ml_item_id: string }[]);

    // Marca recuperados.
    if (resolvidos.length > 0) {
      await admin.from('ml_moderacao')
        .update({ resolvido_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
        .eq('user_id', userId).is('resolvido_em', null).in('ml_item_id', resolvidos);
    }

    // Insere novos (registro aberto).
    if (novos.length > 0) {
      await admin.from('ml_moderacao').insert(
        novos.map((n) => ({ user_id: userId, ml_item_id: n.ml_item_id, status: n.status, motivo: n.motivo })),
      );

      // Alerta agrupado no Telegram; só marca alertado_em se enviou.
      const itensAlerta: ItemAlerta[] = novos.map((n) => ({
        ml_item_id: n.ml_item_id,
        titulo: porItem.get(n.ml_item_id)?.nome ?? null,
        motivo: n.motivo,
        permalink: porItem.get(n.ml_item_id)?.permalink ?? null,
      }));
      const enviou = await enviarTelegram(montarMensagemModerados(itensAlerta));
      if (enviou) {
        await admin.from('ml_moderacao')
          .update({ alertado_em: new Date().toISOString() })
          .eq('user_id', userId).is('resolvido_em', null)
          .in('ml_item_id', novos.map((n) => n.ml_item_id));
      }
      totalNovos += novos.length;
    }
  }

  return new Response(JSON.stringify({ ok: true, novos: totalNovos }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
