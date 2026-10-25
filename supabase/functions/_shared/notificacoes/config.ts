import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { ehSoAdmin, type CategoriaNotificacao } from './categorias.ts';
import { chatPrivado } from './destinatario.ts';
import { enviarTelegram } from './telegram.ts';

export interface ConfigTelegram { token: string | null; chatId: string | null; ativo: boolean }

/** Lê as credenciais/flag do Telegram da organização (tabela configuracoes, E7). */
export async function lerConfigTelegram(admin: SupabaseClient, orgId: string): Promise<ConfigTelegram> {
  const { data } = await admin.from('configuracoes')
    .select('telegram_bot_token, telegram_chat_id, telegram_ativo')
    .eq('org_id', orgId).maybeSingle();
  return {
    token: (data?.telegram_bot_token as string | null) ?? null,
    chatId: (data?.telegram_chat_id as string | null) ?? null,
    ativo: Boolean(data?.telegram_ativo),
  };
}

interface Assinante { id: string; telegram_chat_id: string | null }

function queryAssinantes(admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao) {
  const q = admin.from('profiles')
    .select('id, telegram_chat_id')
    .eq('org_id', orgId)
    .eq('is_active', true);
  return (ehSoAdmin(categoria) ? q.eq('is_admin', true) : q)
    .contains('telegram_categorias', [categoria]);
}

/** chat_ids que recebem por Telegram. Categoria gerencial (ADR-0190): só chat privado, sem repetir
 * (dois profiles com o mesmo chat recebem uma vez). As demais seguem como sempre. */
function chatsTelegram(categoria: CategoriaNotificacao, assinantes: Assinante[]): string[] {
  const chatIds = assinantes.map((a) => a.telegram_chat_id?.trim()).filter((c): c is string => !!c);
  return ehSoAdmin(categoria) ? [...new Set(chatIds.filter(chatPrivado))] : chatIds;
}

/** Há profile ativo, admin e assinante da categoria gerencial na org (ADR-0190)? Vale in-app, então
 * não exige chat. Estrita: `error` lança — falso por erro calaria a notificação sem rastro. */
export async function temAssinanteGerencial(
  admin: SupabaseClient, orgId: string, categoria: 'vendas_gerencial' | 'resumo_diario',
): Promise<boolean> {
  const { data, error } = await queryAssinantes(admin, orgId, categoria).limit(1);
  if (error) throw new Error(`ler assinantes: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Profiles ativos da org que assinam `categoria` (ADR-0068) — base tanto do envio Telegram
 * quanto da notificação in-app (ADR-0085); a assinatura de categoria vale para os dois canais.
 * Tolerante: `error` do select vira lista vazia — é o caminho best-effort de hoje (sem `chave`). */
async function lerAssinantes(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao,
): Promise<Assinante[]> {
  const { data } = await queryAssinantes(admin, orgId, categoria);
  return (data ?? []) as Assinante[];
}

/** Mesma leitura, ESTRITA (ADR-0173): `error` do select lança. Só o caminho com `chave` usa —
 * ali um erro engolido limparia a pendência do worker sem notificar ninguém. */
async function lerAssinantesEstrito(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao,
): Promise<Assinante[]> {
  const { data, error } = await queryAssinantes(admin, orgId, categoria);
  if (error) throw new Error(`ler assinantes: ${error.message}`);
  return (data ?? []) as Assinante[];
}

/** Destinatários Telegram de uma categoria: assinantes ativos com chat_id preenchido.
 * O bot (token) é único da org. Retorna vazio se o Telegram da org estiver inativo ou sem token
 * (interruptor-mestre) — nesse caso ninguém recebe por Telegram, independentemente das assinaturas. */
export async function lerDestinatarios(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao,
): Promise<{ token: string | null; chatIds: string[] }> {
  const cfg = await lerConfigTelegram(admin, orgId);
  if (!cfg.ativo || !cfg.token) return { token: null, chatIds: [] };
  const assinantes = await lerAssinantes(admin, orgId, categoria);
  return { token: cfg.token, chatIds: chatsTelegram(categoria, assinantes) };
}

/** Grava a notificação in-app (ADR-0085) para todo assinante da categoria, independente de ter
 * Telegram configurado. Best-effort: falha de insert não derruba o envio por Telegram. */
async function gravarNotificacoesInApp(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string, assinantes: Assinante[],
): Promise<void> {
  if (assinantes.length === 0) return;
  try {
    const { error } = await admin.from('notificacoes').insert(
      assinantes.map((a) => ({ user_id: a.id, org_id: orgId, categoria, texto })),
    );
    if (error) console.warn('notificação in-app falhou:', error.message);
  } catch (e) {
    console.warn('notificação in-app falhou:', (e as Error).message);
  }
}

/** Envia `texto` a todos que assinam `categoria` na org: grava in-app para todo assinante e manda
 * Telegram para quem tiver chat_id (com o bot da org ativo). Retorna quantos receberam por Telegram.
 *
 * Com `opcoes.chave` (ADR-0173, só a rodada do Pulse usa): leitura ESTRITA, in-app gravado
 * EXATAMENTE UMA VEZ por (usuário, chave) via upsert idempotente — o canal garantido — e Telegram
 * só para quem a linha in-app acabou de nascer, no máximo uma vez (melhor esforço: queda entre o
 * upsert e o envio perde aquele Telegram, mas o registro in-app já ficou). Sem `chave`: caminho de
 * hoje, byte a byte (best-effort, `console.warn`, leitura tolerante). */
export async function notificarCategoria(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string,
  opcoes?: { chave?: string },
): Promise<number> {
  if (opcoes?.chave) return notificarCategoriaComChave(admin, orgId, categoria, texto, opcoes.chave);

  const assinantes = await lerAssinantes(admin, orgId, categoria);
  await gravarNotificacoesInApp(admin, orgId, categoria, texto, assinantes);

  const cfg = await lerConfigTelegram(admin, orgId);
  if (!cfg.ativo || !cfg.token) return 0;
  let enviados = 0;
  for (const chatId of chatsTelegram(categoria, assinantes)) {
    if (await enviarTelegram(cfg.token, chatId, texto)) enviados += 1;
  }
  return enviados;
}

async function notificarCategoriaComChave(
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string, chave: string,
): Promise<number> {
  const assinantes = await lerAssinantesEstrito(admin, orgId, categoria);
  if (assinantes.length === 0) return 0;

  const { data: novas, error } = await admin.from('notificacoes')
    .upsert(
      assinantes.map((a) => ({ user_id: a.id, org_id: orgId, categoria, texto, chave })),
      { onConflict: 'user_id,chave', ignoreDuplicates: true },
    )
    .select('user_id');
  if (error) throw new Error(`gravar notificação in-app: ${error.message}`);

  const idsNovos = new Set(((novas ?? []) as Array<{ user_id: string }>).map((n) => n.user_id));
  if (idsNovos.size === 0) return 0;

  const cfg = await lerConfigTelegram(admin, orgId);
  if (!cfg.ativo || !cfg.token) return 0;
  let enviados = 0;
  for (const chatId of chatsTelegram(categoria, assinantes.filter((a) => idsNovos.has(a.id)))) {
    if (await enviarTelegram(cfg.token, chatId, texto)) enviados += 1;
  }
  return enviados;
}
