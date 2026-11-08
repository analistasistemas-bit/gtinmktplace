// ADR-0200, emenda "Encerrar kit": passo único da transferência `encerrar`, despachado por `avancarSaga` antes do
// pipeline de quantidade. Mesmo claim, mesmas RPCs validadas por token, prazo e exclusão.
//
// - Cada alvo (um por SKU do kit com UP): lê o UP inteiro (`lerOferta`: item e cópias de catálogo) e manda
//   `PUT status=closed` em cada item aberto. Nenhum aberto na leitura = fechamento confirmado (`escrita_em`;
//   `confirmada_em` avançaria a marca d'água do SKU).
// - Erro de leitura ou de PUT num alvo/item não interrompe os outros. Resultado incerto nunca reenvia às cegas:
//   a invocação seguinte relê, e `closed` confirma; aberto recebe novo PUT (fechar é idempotente).
// - Nunca trava (o kit não pode ficar preso em `encerrando`): backoff e alerta por faixa depois da carência.
// - Todos confirmados: `kit_encerrar_finalizar` fecha kit, política, vínculos e transferência numa transação; o
//   aviso de conclusão sai de `avisarKitsEncerrados`, durável pela marca `encerrado_avisado_em`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CategoriaNotificacao } from '../notificacoes/categorias.ts';
import type { AlvoSaga, DepsSaga, ResultadoPasso, TransferenciaSaga } from './saga.ts';

export interface DepsEncerramento {
  /** `kit_encerrar_finalizar`: valida o token e exige todos os alvos confirmados. */
  finalizar(id: string, token: string): Promise<void>;
  /** App + Telegram, idempotente pela chave. */
  avisar(texto: string, chave: string): Promise<void>;
  /** `avisarKitsEncerrados` da org: conclusão e saldo preso, duráveis. */
  avisarConcluidos(): Promise<void>;
}

interface Ctx { deps: DepsSaga; t: TransferenciaSaga; alvos: AlvoSaga[]; token: string; limite: number }

/** Sem alerta antes disto: ML lento para refletir o fechamento é normal. */
const CARENCIA_MS = 15 * 60_000;

/** Backoff pelo tempo desde a primeira intenção: 5 s, 30 s, 60 s, 5 min (teto). */
export function atrasoEncerrar(decorridoMs: number): number {
  const min = decorridoMs / 60_000;
  return min < 1 ? 5 : min < 5 ? 30 : min < 15 ? 60 : 300;
}

/** Faixa do alerta (muda o motivo e a chave): nula na carência; 15 min, 1 h, 6 h, depois por dia. */
export function faixaEncerrar(decorridoMs: number): string | null {
  const h = decorridoMs / 3_600_000;
  if (decorridoMs < CARENCIA_MS) return null;
  if (h < 1) return '15 min';
  if (h < 6) return '1 h';
  if (h < 24) return '6 h';
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Só a resposta 4xx prova que o ML não aplicou. 408 é timeout: incerto. */
function recusa(e: unknown): boolean {
  const st = (e as { status?: unknown } | null)?.status;
  return typeof st === 'number' && st >= 400 && st < 500 && st !== 408;
}

export async function passoEncerrar(ctx: Ctx): Promise<ResultadoPasso> {
  const { deps, t } = ctx;
  const enc = deps.encerramento;
  if (!enc) throw new Error('transferência encerrar sem a porta de encerramento');
  const agora = () => deps.agora().toISOString();
  const vivo = () => {
    if (deps.agora().getTime() > ctx.limite) throw new Error('prazo da execução vencido: nenhum efeito novo');
  };
  const salvar = async (alvo: AlvoSaga, patch: Partial<AlvoSaga>) => {
    vivo();
    await deps.repo.salvarAlvo(t.id, ctx.token, alvo.up_id, patch);
    Object.assign(alvo, patch);
  };

  const pendentes: string[] = [];
  const erros: string[] = [];
  let semLeitura = false;
  for (const alvo of ctx.alvos.filter((a) => !a.escrita_em)) {
    // Início da obrigação (backoff e faixa contam daqui), antes de qualquer efeito.
    if (!alvo.intencao_escrita_em) await salvar(alvo, { intencao_escrita_em: agora() });
    let abertos: string[];
    try {
      abertos = (await deps.ml.lerOferta(alvo.up_id, alvo.item_ids)).itens
        .filter((i) => i.status !== 'closed').map((i) => i.id);
    } catch (e) {
      erros.push(`${alvo.codigo}: leitura do UP ${alvo.up_id}: ${mensagem(e)}`);
      pendentes.push(...alvo.item_ids);
      semLeitura = true;
      continue;
    }
    if (abertos.length === 0) {
      await salvar(alvo, { escrita_em: agora() });
      continue;
    }
    pendentes.push(...abertos);
    for (const id of abertos) {
      vivo();
      try {
        await deps.ml.putStatus(id, 'closed');
      } catch (e) {
        erros.push(`${id}: ${mensagem(e)}`);
        if (recusa(e)) await salvar(alvo, { recusa_definitiva_em: agora(), recusas: alvo.recusas + 1 });
      }
    }
  }
  if (erros.length > 0) console.error(`kit-transferencia ${t.id}: encerrar: ${erros.join('; ')}`);

  if (ctx.alvos.every((a) => a.escrita_em)) {
    vivo();
    await enc.finalizar(t.id, ctx.token);
    // Depois do commit. Falha aqui não volta atrás: a varredura diária reenvia o que faltou.
    await enc.avisarConcluidos()
      .catch((e) => console.error(`kit-transferencia ${t.id}: aviso de encerramento falhou: ${mensagem(e)}`));
    return { passo: 'fim', acao: 'concluida' };
  }

  const inicio = Math.min(...ctx.alvos.map((a) => Date.parse(a.intencao_escrita_em ?? '')).filter((n) => !Number.isNaN(n)));
  const decorrido = Number.isFinite(inicio) ? Math.max(0, deps.agora().getTime() - inicio) : 0;
  const faixa = faixaEncerrar(decorrido);
  // Motivo estável (itens pendentes, leitura falhando e faixa): o alerta sai uma vez por faixa, não a cada erro.
  const itens = [...new Set(pendentes)].sort().join(', ');
  const causa = semLeitura ? '; o Mercado Livre não respondeu à leitura do anúncio (confira a conexão)' : '';
  const motivo = `encerramento pendente: ${itens}${causa}${faixa ? ` (há ${faixa})` : ''}`;
  vivo();
  await deps.repo.salvarTransferencia(t.id, ctx.token, { passo: t.passo, alerta: motivo });
  vivo();
  await deps.enfileirar(t.id, atrasoEncerrar(decorrido));
  if (faixa && t.alerta !== motivo) {
    await enc.avisar(
      `⚠️ Encerramento de kit pendente há ${faixa}\n\nO Mercado Livre ainda não fechou: ${itens}${causa}. `
        + 'O PubliAI segue tentando sozinho. Confira esses anúncios no Mercado Livre.',
      `kit_encerrar_pendente:${t.id}:${faixa}`,
    ).catch((e) => console.error(`kit-transferencia ${t.id}: alerta de encerramento falhou: ${mensagem(e)}`));
  }
  return { passo: t.passo, acao: 'reagendada', motivo };
}

export type Notificar = (
  admin: SupabaseClient, orgId: string, categoria: CategoriaNotificacao, texto: string, opcoes: { chave: string },
) => Promise<unknown>;

/**
 * Avisos duráveis do encerramento (emenda, item 7), idempotentes pela chave. Para cada kit `encerrado` da org:
 * - conclusão, se ainda sem `encerrado_avisado_em` (marcada só depois do envio);
 * - saldo preso: SKU do kit com saldo diferente de 0 (crédito durante o encerramento ou estorno depois), uma vez por
 *   último movimento do SKU. O kit não é remontado: o operador ajusta à mão.
 * Roda depois da conclusão (worker), depois de crédito de cancelamento em SKU de kit e na reconciliação diária. Só
 * para org com o módulo (quem chama já sabe). Erro de leitura lança; erro de envio de um aviso não impede os outros.
 */
export async function avisarKitsEncerrados(admin: SupabaseClient, notificar: Notificar, orgId: string): Promise<number> {
  const { data: kits, error } = await admin.from('kits_variacao')
    .select('id, codigo_pai_kit, encerrado_avisado_em, kit_variacao_skus(codigo)')
    .eq('org_id', orgId).eq('status', 'encerrado');
  if (error) throw new Error(`kits_variacao: ${error.message}`);
  if (!kits?.length) return 0;
  const skusDe = (k: Record<string, unknown>) => ((k.kit_variacao_skus ?? []) as Array<{ codigo: string }>).map((s) => s.codigo);
  const codigos = kits.flatMap(skusDe);
  const { data: saldos, error: e2 } = await admin.rpc('kit_saldo_canonico', { p_org: orgId, p_codigos: codigos });
  if (e2) throw new Error(`kit_saldo_canonico: ${e2.message}`);
  const saldo = (saldos ?? {}) as Record<string, number>;

  let n = 0;
  const enviar = async (texto: string, chave: string) => {
    try {
      await notificar(admin, orgId, 'estoque', texto, { chave });
      n++;
      return true;
    } catch (e) {
      console.error('kit_encerrado_aviso_falhou', orgId, chave, mensagem(e));
      return false;
    }
  };
  for (const k of kits as Array<Record<string, unknown>>) {
    if (!k.encerrado_avisado_em) {
      const ok = await enviar(`🧩 Kit encerrado: ${k.codigo_pai_kit}\n\nOs anúncios do kit foram fechados no Mercado Livre e o kit `
        + 'saiu de Publicados. As peças voltam a vender pelos anúncios individuais, salvo pausa do operador ou outro kit que '
        + 'as guarde.', `kit_encerrado:${k.id}`);
      if (ok) {
        const { error: e3 } = await admin.from('kits_variacao').update({ encerrado_avisado_em: new Date().toISOString() })
          .eq('id', k.id as string).is('encerrado_avisado_em', null);
        // Sem a marca, a próxima varredura reenvia com a mesma chave: não duplica.
        if (e3) console.error('kit_encerrado_marcar_falhou', orgId, k.id, e3.message);
      }
    }
    for (const codigo of skusDe(k).filter((c) => (saldo[c] ?? 0) !== 0).sort()) {
      const { data: ultimo, error: e4 } = await admin.from('estoque_movimentos').select('id')
        .eq('org_id', orgId).eq('codigo', codigo).order('ordem', { ascending: false }).limit(1);
      if (e4) throw new Error(`estoque_movimentos: ${e4.message}`);
      await enviar(`⚠️ Saldo em kit encerrado: ${codigo} (kit ${k.codigo_pai_kit})\n\nO SKU ficou com saldo ${saldo[codigo]} `
        + 'depois do encerramento (cancelamento ou devolução de pedido antigo). O kit não é remontado nem volta a vender: '
        + 'confira as peças e ajuste o estoque à mão.', `kit_encerrado_saldo:${codigo}:${ultimo?.[0]?.id ?? 'sem-movimento'}`);
    }
  }
  return n;
}

/** Varredura diária (reconciliar-estoque): todas as orgs com o módulo. Erro por org só loga. */
export async function avisarKitsEncerradosDasOrgs(admin: SupabaseClient, notificar: Notificar): Promise<number> {
  const { data, error } = await admin.from('organizations').select('id').contains('modulos_habilitados', ['kit_variacao']);
  if (error) throw new Error(`organizations: ${error.message}`);
  let n = 0;
  for (const o of data ?? []) {
    try {
      n += await avisarKitsEncerrados(admin, notificar, o.id as string);
    } catch (e) {
      console.error('kit_encerrado_aviso_org_falhou', o.id, mensagem(e));
    }
  }
  return n;
}
