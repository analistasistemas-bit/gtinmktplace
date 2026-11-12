// ADR-0203 item 11: aviso "suas imagens ficaram prontas", no app e no Telegram, só para quem fez o pedido.
// Rodada = pedidos do mesmo `criado_por` no mesmo anúncio nas últimas 3 h. Pronta = nenhuma imagem aberta e nenhuma
// `gerada` sem conferência (`alertas` nulo). Idempotência igual a `notificarCategoria` com chave (config.ts): upsert por
// (user_id, chave) ignorando duplicata; Telegram só para a linha recém-criada, reservado por (chave, chat). Não cobra nada.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { lerConfigTelegram } from '../notificacoes/config.ts';
import { enviarTelegram } from '../notificacoes/telegram.ts';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { ehPlano } from './plano.ts';

const JANELA_MS = 3 * 60 * 60_000;
const ABERTOS = new Set(['pendente', 'submetendo', 'gerando']);
const FORA = new Set(['desatualizada', 'descartada']);

interface Pedido {
  id: string; org_id: string; anuncio_externo_id: string | null; familia_id: string | null; criado_por: string; criado_em: string;
}
interface Imagem { pedido_id: string; status: string; alertas: unknown; cena_path: string | null; roteiro_id: string | null }
interface Deps { agora: Date; appUrl: string; enviar?: typeof enviarTelegram }

function exigir<T>(r: { data: T; error: { message: string } | null }, onde: string): T {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
  return r.data;
}

const pronta = (imgs: Imagem[]) =>
  imgs.length > 0 && !imgs.some((i) => ABERTOS.has(i.status) || (i.status === 'gerada' && i.alertas == null));

/** Puro. Texto de uma linha; sem link → "Abra a galeria em Publicados." */
export function textoAviso(titulo: string, prontas: number, falhas: number, link: string | null): string {
  const nao = falhas === 1 ? '1 não saiu' : `${falhas} não saíram`;
  if (prontas === 0) {
    return `Não foi possível gerar as imagens de ${titulo} (${nao}). `
      + (link ? `Abra para tentar de novo: ${link}` : 'Abra a galeria em Publicados.');
  }
  return `Suas imagens ficaram prontas: ${titulo}. ${prontas} para conferir${falhas > 0 ? `, ${nao}` : ''}. `
    + (link ? `Abra para aprovar: ${link}` : 'Abra a galeria em Publicados.');
}

async function mlItemDoAnuncio(admin: SupabaseClient, orgId: string, anuncioId: string | null): Promise<string | null> {
  if (!anuncioId) return null;
  const an = exigir(await admin.from('anuncios_externos').select('item_externo_id')
    .eq('id', anuncioId).eq('org_id', orgId).maybeSingle(), 'ler anúncio') as { item_externo_id: string | null } | null;
  if (an?.item_externo_id) return an.item_externo_id;
  const filhos = exigir(await admin.from('anuncios_externos_itens').select('item_externo_id')
    .eq('anuncio_externo_id', anuncioId).eq('org_id', orgId).eq('retirado', false).not('item_externo_id', 'is', null)
    .order('sku').limit(1), 'ler itens do anúncio') as Array<{ item_externo_id: string }>;
  return filhos[0]?.item_externo_id ?? null;
}

async function avisarRodada(admin: SupabaseClient, recente: Pedido, imgs: Imagem[], chave: string, deps: Deps): Promise<boolean> {
  const { org_id: orgId, criado_por: userId } = recente;
  const prontas = imgs.filter((i) => i.status === 'gerada' || i.status === 'aprovada').length;
  const falhas = imgs.filter((i) => i.status === 'falhou').length;
  if (prontas + falhas === 0) return false; // só descartada/desatualizada: nada a avisar

  const mlItem = await mlItemDoAnuncio(admin, orgId, recente.anuncio_externo_id);
  const fam = recente.familia_id
    ? exigir(await admin.from('familias').select('titulo_ml, nome_pai').eq('id', recente.familia_id).eq('org_id', orgId).maybeSingle(), 'ler família') as
      { titulo_ml: string | null; nome_pai: string | null } | null
    : null;
  const titulo = fam?.titulo_ml?.trim() || fam?.nome_pai?.trim() || 'seu anúncio';
  const base = deps.appUrl.trim().replace(/\/$/, '');
  const link = base && mlItem ? `${base}/#/publicados/${mlItem}/galeria` : null;
  const texto = textoAviso(titulo, prontas, falhas, link);

  const novas = exigir(await admin.from('notificacoes')
    .upsert({ user_id: userId, org_id: orgId, categoria: 'imagem_ia', texto, chave }, { onConflict: 'user_id,chave', ignoreDuplicates: true })
    .select('id'), 'gravar notificação') as Array<{ id: string }> | null;
  if ((novas ?? []).length === 0) return false;

  // Telegram é melhor esforço: o aviso do app já ficou.
  try {
    const cfg = await lerConfigTelegram(admin, orgId);
    if (!cfg.ativo || !cfg.token) return true;
    const perfil = exigir(await admin.from('profiles').select('telegram_chat_id').eq('id', userId).eq('org_id', orgId).maybeSingle(), 'ler perfil') as
      { telegram_chat_id: string | null } | null;
    const chatId = perfil?.telegram_chat_id?.trim();
    if (!chatId) return true;
    if (!await reservarNotificacao(admin, orgId, userId, 'telegram_chave', `${chave}:${chatId}`)) return true;
    await (deps.enviar ?? enviarTelegram)(cfg.token, chatId, texto);
  } catch (e) {
    console.error('[galeria-aviso] telegram', chave, (e as Error).message);
  }
  return true;
}

/** Avisa as rodadas prontas ainda não avisadas. Devolve o nº de avisos novos (linhas criadas em `notificacoes`). */
export async function avisarPedidosProntos(admin: SupabaseClient, deps: Deps): Promise<number> {
  const desde = new Date(deps.agora.getTime() - JANELA_MS).toISOString();
  // ponytail: sem paginação; 3 h de pedidos cabem numa página. Paginar se a janela ou o volume crescerem.
  const pedidos = (exigir(await admin.from('galeria_pedidos')
    .select('id, org_id, anuncio_externo_id, familia_id, criado_por, criado_em')
    .gte('criado_em', desde).not('criado_por', 'is', null), 'ler pedidos') ?? []) as Pedido[];
  if (pedidos.length === 0) return 0;

  const todas = (exigir(await admin.from('galeria_imagens').select('pedido_id, status, alertas, cena_path, roteiro_id')
    .in('pedido_id', pedidos.map((p) => p.id)), 'ler imagens') ?? []) as Imagem[];
  // Só imagens do plano formato 2 (ADR-0203) contam: pedido de roteiro antigo na janela nunca avisa nem segura a
  // rodada, e pedido sem imagem do formato 2 nunca define a chave. Desatualizada/descartada não contam.
  const idsRoteiro = [...new Set(todas.map((i) => i.roteiro_id).filter((r): r is string => !!r))];
  const roteiros = idsRoteiro.length === 0 ? [] : (exigir(await admin.from('galeria_roteiros').select('id, conteudo')
    .in('id', idsRoteiro), 'ler roteiros') ?? []) as Array<{ id: string; conteudo: unknown }>;
  const formato2 = new Set(roteiros.filter((r) => ehPlano(r.conteudo)).map((r) => r.id));
  const doPlano = todas.filter((i) => i.roteiro_id !== null && formato2.has(i.roteiro_id));
  const comPlano = new Set(doPlano.map((i) => i.pedido_id));
  const imagens = doPlano.filter((i) => !FORA.has(i.status));

  const rodadas = new Map<string, Pedido[]>();
  for (const p of pedidos.filter((x) => comPlano.has(x.id))) {
    const k = `${p.org_id}|${p.anuncio_externo_id ?? ''}|${p.criado_por}`;
    rodadas.set(k, [...(rodadas.get(k) ?? []), p]);
  }

  const prontas: Array<{ recente: Pedido; imgs: Imagem[]; chave: string }> = [];
  for (const ps of rodadas.values()) {
    const ids = new Set(ps.map((p) => p.id));
    const imgs = imagens.filter((i) => ids.has(i.pedido_id));
    if (!pronta(imgs)) continue;
    const recente = [...ps].sort((a, b) =>
      Date.parse(b.criado_em) - Date.parse(a.criado_em) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];
    prontas.push({ recente, imgs, chave: `galeria_pronta:${recente.id}` });
  }
  if (prontas.length === 0) return 0;

  // Já avisadas saem antes de ler anúncio e família (o upsert continua sendo a garantia contra corrida).
  // user_id primeiro: o índice único é (user_id, chave).
  const ja = (exigir(await admin.from('notificacoes').select('user_id, chave')
    .in('user_id', [...new Set(prontas.map((r) => r.recente.criado_por))])
    .in('chave', prontas.map((r) => r.chave)), 'ler avisos') ?? []) as Array<{ user_id: string; chave: string }>;
  const avisadas = new Set(ja.map((n) => `${n.user_id}|${n.chave}`));

  let n = 0;
  for (const r of prontas) {
    if (avisadas.has(`${r.recente.criado_por}|${r.chave}`)) continue;
    try {
      if (await avisarRodada(admin, r.recente, r.imgs, r.chave, deps)) n++;
    } catch (e) {
      console.error('[galeria-aviso]', r.chave, (e as Error).message);
    }
  }
  return n;
}
