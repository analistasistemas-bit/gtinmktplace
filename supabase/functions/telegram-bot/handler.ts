// Bot de comandos (ADR-0190 D-8/D-9) — roteamento da edge telegram-bot, isolado do Deno.serve para teste.
// - header `upstash-signature` (assinatura obrigatória): `{ bot_id, update_id }` → worker;
//   `{ varrer: true, depois? }` → varredura;
// - header `X-Telegram-Bot-Api-Secret-Token` → webhook (org da URL, secret HMAC de org+bot);
// - qualquer outra coisa → 401.
// O worker revalida bot/org/papel a cada execução; `org_id` vem só da linha da inbox, nunca do payload.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { enviarTelegram } from '../_shared/notificacoes/telegram.ts';
import { VolumeAcimaDoLimite } from '../_shared/platform-admin/metrics-repository.ts';
import { avaliarAcesso, interpretarComando, secretValido, type Comando } from '../_shared/notificacoes/gerencial/bot.ts';
import {
  concluir, confirmarPosse, devolver, publicarUpdate, receberUpdate, reivindicar, varrerInbox, type Pk,
} from '../_shared/notificacoes/gerencial/inbox.ts';
import { consultarHoje, consultarMes, consultarOntem, consultarTop } from '../_shared/notificacoes/gerencial/consultas.ts';
import {
  montarHoje, montarMes, montarResumoDiario, montarTop,
  TEXTO_AJUDA, TEXTO_ERRO, TEXTO_SEM_ACESSO, TEXTO_SO_PRIVADO, TEXTO_VOLUME,
} from '../_shared/notificacoes/gerencial/mensagens.ts';

export interface Deps { admin: SupabaseClient; chave: string | undefined; agora: () => Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TENTATIVAS = 5;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'telegram-bot', ...o }));
const inteiro = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

interface Bot { botId: number | null; token: string | null; ativo: boolean }

/** Bot da org numa leitura só (id, token, flag). Lança em erro. */
async function lerBot(admin: SupabaseClient, orgId: string): Promise<Bot> {
  const { data, error } = await admin.from('configuracoes')
    .select('telegram_bot_id, telegram_bot_token, telegram_ativo').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`ler bot: ${error.message}`);
  return {
    botId: data?.telegram_bot_id != null ? Number(data.telegram_bot_id) : null,
    token: (data?.telegram_bot_token as string | null) ?? null,
    ativo: Boolean(data?.telegram_ativo),
  };
}

function lerPerfisDoChat(admin: SupabaseClient, orgId: string, chatId: string) {
  return paginarTudo<{ is_admin: boolean; is_active: boolean }>((de, ate) => admin.from('profiles')
    .select('is_admin, is_active').eq('org_id', orgId).eq('telegram_chat_id', chatId)
    .order('id').range(de, ate));
}

async function textoDoComando(admin: SupabaseClient, orgId: string, comando: Comando, agora: Date): Promise<string> {
  try {
    switch (comando) {
      case 'hoje': { const r = await consultarHoje(admin, orgId, agora); return montarHoje(r.k, r.l); }
      case 'mes': { const r = await consultarMes(admin, orgId, agora); return montarMes(r.k, r.l); }
      case 'top': { const r = await consultarTop(admin, orgId, agora); return montarTop(r.top, r.rotuloMes, r.cobertura); }
      case 'ontem': return montarResumoDiario((await consultarOntem(admin, orgId, agora)).dados);
      default: return TEXTO_AJUDA;
    }
  } catch (e) {
    if (e instanceof VolumeAcimaDoLimite) return TEXTO_VOLUME;
    throw e;
  }
}

/** Resposta ao update, ou null quando não há o que responder (mensagem sem chat; texto livre em grupo).
 *  Acesso ANTES do comando: dado só para admin ativo da org, em conversa privada. */
async function resposta(
  admin: SupabaseClient, orgId: string, chat: { id: number; type: string }, texto: string | undefined, agora: Date,
): Promise<string | null> {
  const comando = interpretarComando(texto);
  const perfis = chat.type === 'private' ? await lerPerfisDoChat(admin, orgId, String(chat.id)) : [];
  const acesso = avaliarAcesso(chat, perfis);
  if (acesso === 'grupo') return comando || texto?.trim().startsWith('/') ? TEXTO_SO_PRIVADO : null;
  if (acesso === 'sem_acesso') return TEXTO_SEM_ACESSO;
  return textoDoComando(admin, orgId, comando, agora);
}

async function worker(d: Deps, botId: number, updateId: number): Promise<Response> {
  const { admin } = d;
  const posse = await reivindicar(admin, botId, updateId, d.agora());
  if (!posse) return json({ ok: true, resultado: 'sem_posse' });
  const { row, leaseId } = posse;
  const pk: Pk = { botId, updateId };
  let token: string | null = null;
  let chatId: string | null = null;
  try {
    const bot = await lerBot(admin, row.org_id);
    if (bot.botId !== Number(row.bot_id) || !bot.ativo || !bot.token) {
      await concluir(admin, pk, leaseId, 'falhou', 'bot desvinculado');
      return json({ ok: true, resultado: 'bot_desvinculado' });
    }
    token = bot.token;
    const msg = (row.payload?.message ?? null) as { text?: string; chat?: { id?: unknown; type?: unknown } } | null;
    const chat = msg?.chat;
    if (!chat || !Number.isSafeInteger(chat.id) || typeof chat.type !== 'string') {
      await concluir(admin, pk, leaseId, 'respondido');
      return json({ ok: true, resultado: 'sem_chat' });
    }
    chatId = String(chat.id);
    const texto = await resposta(admin, row.org_id, chat as { id: number; type: string }, msg?.text, d.agora());
    if (texto == null) {
      await concluir(admin, pk, leaseId, 'respondido');
      return json({ ok: true, resultado: 'ignorado' });
    }
    // Relógio novo: a consulta pode ter passado do lease; execução vencida aborta sem enviar.
    if (!await confirmarPosse(admin, pk, leaseId, d.agora())) return json({ ok: true, resultado: 'posse_perdida' });
    if (!await enviarTelegram(token, chatId, texto)) {
      await devolver(admin, pk, leaseId, 'envio falhou');
      return json({ ok: false, erro: 'envio falhou' }, 500);
    }
    await concluir(admin, pk, leaseId, 'respondido');
    log({ botId, updateId, org: row.org_id, resultado: 'respondido' });
    return json({ ok: true, resultado: 'respondido' });
  } catch (e) {
    const erro = (e as Error).message;
    log({ botId, updateId, org: row.org_id, erro });
    try {
      // Última tentativa: avisa o chat (texto fixo, sem dado) antes de encerrar como falhou.
      if (row.tentativas >= MAX_TENTATIVAS && token && chatId && await confirmarPosse(admin, pk, leaseId, d.agora())) {
        await enviarTelegram(token, chatId, TEXTO_ERRO);
      }
      await devolver(admin, pk, leaseId, erro);
    } catch (e2) {
      log({ botId, updateId, erro: `devolver: ${(e2 as Error).message}` });
    }
    return json({ ok: false, erro }, 500);
  }
}

async function webhook(d: Deps, req: Request, secret: string): Promise<Response> {
  if (!d.chave) {
    console.error('telegram-bot: TELEGRAM_WEBHOOK_KEY ausente');
    return json({ ok: false, erro: 'configuração ausente' }, 500);
  }
  const orgId = new URL(req.url).searchParams.get('org') ?? '';
  if (!UUID.test(orgId)) return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  try {
    const bot = await lerBot(d.admin, orgId);
    if (bot.botId == null || !bot.ativo) return json({ ok: true, resultado: 'bot_inativo' });
    if (!await secretValido(d.chave, orgId, bot.botId, secret)) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    let update: { update_id?: unknown };
    try { update = await req.json(); } catch { return json({ ok: true, resultado: 'ignorado' }); }
    // Payload inválido → 200: um 500 faria o Telegram reenviar para sempre.
    if (!inteiro(update?.update_id)) return json({ ok: true, resultado: 'ignorado' });
    const estado = await receberUpdate(d.admin, orgId, bot.botId, update as { update_id: number });
    if (estado !== 'concluida') await publicarUpdate(d.admin, bot.botId, update.update_id as number);
    return json({ ok: true, resultado: estado });
  } catch (e) {
    log({ org: orgId, erro: (e as Error).message });
    return json({ ok: false }, 500);
  }
}

export async function tratar(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  if (req.headers.has('upstash-signature')) {
    const body = await req.text();
    if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
    let job: { bot_id?: unknown; update_id?: unknown; varrer?: boolean; depois?: Pk };
    try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
    if (job.varrer) {
      try {
        return json({ ok: true, publicados: await varrerInbox(d.admin, d.agora(), job.depois) });
      } catch (e) {
        log({ varrer: true, erro: (e as Error).message });
        return json({ ok: false, erro: (e as Error).message }, 500);
      }
    }
    if (!inteiro(job.bot_id) || !inteiro(job.update_id)) return new Response('bot_id e update_id obrigatórios', { status: 400, headers: corsHeaders });
    try {
      return await worker(d, job.bot_id, job.update_id);
    } catch (e) {
      // reivindicar falhou (banco): nada mudou na linha; o QStash tenta de novo.
      log({ botId: job.bot_id, updateId: job.update_id, erro: (e as Error).message });
      return json({ ok: false, erro: (e as Error).message }, 500);
    }
  }

  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== null) return webhook(d, req, secret);
  return new Response('Unauthorized', { status: 401, headers: corsHeaders });
}
