// Responde mensagem pós-venda no ML (ADR-0067). Chamada pelo frontend (JWT). Texto do operador
// (podendo ter sido sugerido por IA) — revisão humana sempre. Usa a conta ML da própria org.
// Trava, idempotência e conferência em _shared/faturamento/mensagem-fluxo.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import {
  buscarMensagensPack,
  pedidoCancelado,
  upsertMensagens,
  resolverMetaPack,
  resolverCompradorId,
  marcarConversaCancelada,
  ERRO_PEDIDO_CANCELADO,
  CODIGO_PEDIDO_CANCELADO,
  ERRO_EM_MEDIACAO,
} from '../_shared/faturamento/mensagens-io.ts';
import { enviarMensagem, liberarEnvio, verificarEnvio, type ResultadoEnvio } from '../_shared/faturamento/mensagem-fluxo.ts';
import { depsMensagemReal } from '../_shared/faturamento/mensagem-fluxo-io.ts';

interface Body { pack_id?: string; text?: string; operacao_id?: unknown; anexo?: unknown; verificar?: boolean; liberar?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANEXO = /^[\w.-]{1,200}$/;

/** Reclamação aberta no pedido: o ML recusa a mensagem (403 `blocked_by_claim`) e a conversa segue
 *  pela reclamação. Emenda ADR-0067 (01/11). */
const ERRO_RECLAMACAO_ABERTA = 'Este pedido tem reclamação aberta no Mercado Livre: responda pela reclamação.';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const erro = (msg: string, status: number, codigo?: string) => json({ ok: false, erro: msg, ...(codigo ? { codigo } : {}) }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const packId = String(body.pack_id ?? '').trim();
  const text = (body.text ?? '').trim();
  const verificar = body.verificar === true;
  const liberar = body.liberar === true;
  if (verificar && liberar) return erro('Use verificar ou liberar, não os dois.', 400);
  if (!packId || (!text && !verificar && !liberar)) return erro('pack_id e text obrigatórios', 400);
  if (!/^\d+$/.test(packId)) return erro('pack_id inválido', 400);
  if (text.length > 350) return erro('Mensagem excede 350 caracteres.', 400); // limite do ML no pós-venda.
  const { operacao_id: operacaoInformada, anexo } = body;
  if ((verificar || liberar) && operacaoInformada == null) return erro('operacao_id obrigatório', 400);
  if (operacaoInformada != null && (typeof operacaoInformada !== 'string' || !UUID.test(operacaoInformada))) return erro('operacao_id inválido', 400);
  if (anexo != null && (typeof anexo !== 'string' || !ANEXO.test(anexo))) return erro('anexo inválido', 400);

  const admin = adminClient();
  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);
  const sellerId = conexao.contaExternaId;
  const dono = (cxRow?.criado_por as string | null) ?? null; // mesma chave user_id do sync/backfill.

  const meta = await resolverMetaPack(admin, dono ?? context.userId, packId);
  if (pedidoCancelado(meta.orderStatus)) {
    await marcarConversaCancelada(admin, orgId, packId, dono).catch((e) =>
      console.error('[responder-mensagem] falha ao marcar conversa cancelada:', e)
    );
    return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
  }

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  const buyerId = await resolverCompradorId(admin, orgId, packId);
  if (!buyerId) return erro('Não foi possível identificar o comprador desta conversa.', 400);

  const deps = depsMensagemReal(admin, { orgId, packId, sellerId, buyerId, token });
  const operacaoId = (operacaoInformada as string | null | undefined) ?? crypto.randomUUID();
  const legado = operacaoInformada == null; // bundle antigo do PWA: sem Conferir nem Liberar.
  let r: ResultadoEnvio;
  try {
    r = verificar ? await verificarEnvio(deps, packId, operacaoId)
      : liberar ? await liberarEnvio(deps, packId, operacaoId)
      : await enviarMensagem(deps, {
        orgId, userId: context.userId, packId, operacaoId,
        payload: { texto: text, anexo: (anexo as string | null | undefined) ?? null }, // ordem e forma entram no payload_hash.
        ...(legado ? { legado } : {}),
      });
  } catch (e) {
    // Erro de banco no meio: o estado gravado é a verdade; "Conferir" com o mesmo operacao_id retoma sem POST.
    console.error(`[responder-mensagem] pack ${packId} org ${orgId}:`, (e as Error).message);
    await auditarOperacaoSuporte(admin, context, { type: 'pack', id: packId }, 'failed').catch(() => {});
    return erro('Falha interna ao registrar o envio. Use "Conferir" antes de tentar de novo.', 500);
  }

  // O envio no ML já pode ter acontecido: falha de auditoria não vira erro (o cliente repetiria às cegas).
  const auditar = async (resultado: 'succeeded' | 'failed') => {
    if (verificar) return;
    await auditarOperacaoSuporte(admin, context, { type: 'pack', id: packId }, resultado)
      .catch((e) => console.error('[responder-mensagem] auditoria de suporte falhou:', (e as Error).message));
  };

  if (!r.ok) {
    if (r.erro === ERRO_PEDIDO_CANCELADO) {
      await marcarConversaCancelada(admin, orgId, packId, dono).catch((e) =>
        console.error('[responder-mensagem] falha ao marcar conversa cancelada:', e)
      );
      return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
    }
    await auditar('failed');
    if (r.erro === ERRO_EM_MEDIACAO || r.erro?.includes('blocked_by_claim')) return erro(ERRO_RECLAMACAO_ABERTA, 409, 'reclamacao_aberta');
    const { http, ...corpo } = r;
    return json(corpo, http);
  }

  // Re-busca o pack (captura a mensagem enviada) e marca as recebidas como lidas (limpa o badge).
  // A mensagem já saiu: falha aqui não reabre o envio.
  if ((r.estado === 'confirmada' || (legado && r.estado === 'inconclusiva')) && dono) {
    try {
      const msgs = await buscarMensagensPack(token, packId, sellerId);
      if (msgs.length) {
        const meta = await resolverMetaPack(admin, dono, packId);
        await upsertMensagens(admin, dono, orgId, packId, meta, sellerId, msgs);
      }
      await admin.from('ml_mensagens').update({ lida: true, atualizado_em: new Date().toISOString() })
        .eq('user_id', dono).eq('pack_id', packId).eq('direcao', 'recebida').eq('lida', false);
    } catch (e) {
      console.error('[responder-mensagem] re-sync falhou:', (e as Error).message);
    }
  }

  await auditar('succeeded');
  return json({ ok: true, estado: r.estado, operacao_id: r.operacao_id, pendenteConfirmacao: r.pendenteConfirmacao });
});
