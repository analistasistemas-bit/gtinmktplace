// Bot de comandos do Telegram (ADR-0190 D-8/D-9): webhook (secret HMAC org+bot) → inbox durável →
// QStash → worker com lease → resposta; varredura republica linhas paradas. Lógica em handler.ts.
import { adminClient } from '../_shared/supabase.ts';
import { tratar } from './handler.ts';

Deno.serve((req) => tratar(req, {
  admin: adminClient(), chave: Deno.env.get('TELEGRAM_WEBHOOK_KEY'), agora: () => new Date(),
}));
