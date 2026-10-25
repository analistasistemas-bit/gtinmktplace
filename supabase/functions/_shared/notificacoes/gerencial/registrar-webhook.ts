// Ação `registrar_webhook_telegram` da edge usuarios (ADR-0190 D-8), isolada do Deno.serve para teste
// (molde usuarios/marca-org.ts): getMe → bot_id (um bot por org) → setWebhook com o secret da org →
// setMyCommands. Nunca devolve nem loga URL/erro com o token.
import { secretDaOrg } from './bot.ts';

export interface DepsRegistrar {
  orgId: string;
  chave: string | undefined;
  supabaseUrl: string;
  lerToken: () => Promise<string | null>;
  outraOrgComBot: (botId: number) => Promise<boolean>;
  /** null = gravou; senão o erro do banco (`23505` = unique de telegram_bot_id). */
  gravarBotId: (botId: number) => Promise<{ code?: string; message: string } | null>;
  fetch?: typeof fetch;
}
export interface Resposta { status: number; body: Record<string, unknown> }

const COMANDOS = [
  { command: 'hoje', description: 'Vendas e lucro de hoje' },
  { command: 'ontem', description: 'Vendas e lucro de ontem' },
  { command: 'mes', description: 'Vendas e lucro do mês' },
  { command: 'top', description: 'Produtos de maior lucro do mês' },
  { command: 'ajuda', description: 'Lista de comandos' },
];
const JA_LIGADO: Resposta = { status: 409, body: { error: 'Este bot já está ligado a outra organização.' } };

export async function registrarWebhookTelegram(d: DepsRegistrar): Promise<Resposta> {
  if (!d.chave) {
    console.error('registrar_webhook_telegram: TELEGRAM_WEBHOOK_KEY ausente');
    return { status: 500, body: { error: 'Comandos do bot indisponíveis (configuração do servidor).' } };
  }
  const token = await d.lerToken();
  if (!token) return { status: 400, body: { error: 'Salve o token do bot antes de ativar os comandos.' } };
  const f = d.fetch ?? fetch;
  const chamar = async (metodo: string, corpo?: unknown): Promise<{ ok?: boolean; result?: { id?: unknown } } | null> => {
    try {
      const resp = await f(`https://api.telegram.org/bot${token}/${metodo}`, corpo === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      return await resp.json();
    } catch {
      return null;
    }
  };

  const eu = await chamar('getMe');
  const botId = Number(eu?.result?.id);
  if (!eu?.ok || !Number.isSafeInteger(botId) || botId <= 0) {
    return { status: 400, body: { error: 'O Telegram recusou o token do bot. Confira e salve de novo.' } };
  }
  if (await d.outraOrgComBot(botId)) return JA_LIGADO;
  const erro = await d.gravarBotId(botId);
  if (erro) return erro.code === '23505' ? JA_LIGADO : { status: 500, body: { error: `Falha ao gravar o bot: ${erro.message}` } };

  const hook = await chamar('setWebhook', {
    url: `${d.supabaseUrl}/functions/v1/telegram-bot?org=${d.orgId}`,
    secret_token: await secretDaOrg(d.chave, d.orgId, botId),
    allowed_updates: ['message'],
    drop_pending_updates: false,
  });
  if (!hook?.ok) return { status: 502, body: { error: 'O Telegram não aceitou o webhook. Tente de novo.' } };
  const cmds = await chamar('setMyCommands', { commands: COMANDOS });
  if (!cmds?.ok) return { status: 502, body: { error: 'O Telegram não aceitou a lista de comandos. Tente de novo.' } };
  return { status: 200, body: { ok: true } };
}
