// Edge Function: lead-landing-telegram
// Chamada pelo JS da landing depois que o FormSubmit aceitou o lead (ADR-0152): avisa no Telegram
// da Daludi. Não é o _webhook do FormSubmit: com ele o FormSubmit responde 500 e o lead não sai. Bot dedicado (TELEGRAM_BOT_TOKEN + TELEGRAM_LEADS_CHAT_ID), fora do Telegram por org.
// O e-mail do FormSubmit continua sendo o registro; este aviso é best-effort.
// ponytail: a URL é pública (fica no HTML); o filtro é só leadValido. Rate limit se aparecer spam.
import { enviarTelegram } from '../_shared/notificacoes/telegram.ts';
import { leadValido, montarMensagemLead } from './mensagem.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return json(400, { ok: false, erro: 'corpo não é JSON' });
  }
  const dados = (corpo?.form_data ?? corpo ?? {}) as Record<string, unknown>;
  if (!leadValido(dados)) return json(400, { ok: false, erro: 'lead incompleto' });

  const enviado = await enviarTelegram(
    Deno.env.get('TELEGRAM_BOT_TOKEN') ?? null,
    Deno.env.get('TELEGRAM_LEADS_CHAT_ID') ?? null,
    montarMensagemLead(dados),
  );
  return json(enviado ? 200 : 502, { ok: enviado });
});
