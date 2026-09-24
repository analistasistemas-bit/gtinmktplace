// ADR-0170 §9 — alertas da Central de Promoções: participando no prejuízo e prazo acabando.
// Lê o banco (última leitura concluída). Uma mensagem por org por sync, só com o que reservou
// agora — o 1º sync não despeja histórico (ADR-0121).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reservarNotificacao } from '../faturamento/notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { Contagem, ProjecaoCor } from './tipos.ts';

const JANELA_PRAZO_MS = 48 * 3_600_000;
const MAX_LISTADOS = 10;

export interface PromoAlerta { promocao_id: string; nome: string | null; status: string; prazo_adesao: string | null; contagem: Contagem | null }
export interface ItemAlerta { promocao_id: string; ml_item_id: string; titulo: string | null; preco_avaliado: number | null; projecao: ProjecaoCor[] }
export interface DepsAlertas {
  ativo(): Promise<boolean>;
  lerPromocoes(): Promise<PromoAlerta[]>;
  lerParticipandoNoPrejuizo(): Promise<ItemAlerta[]>;
  reservar(entidade: 'promo_prejuizo' | 'promo_prazo', chave: string): Promise<boolean>;
  notificar(texto: string): Promise<number>;
}
export type Selecao = { prejuizo: { promo: PromoAlerta; item: ItemAlerta }[]; prazo: { promo: PromoAlerta; verdes: number }[] };

export function selecionarAlertas(promos: PromoAlerta[], prejuizo: ItemAlerta[], agoraMs: number): Selecao {
  const porId = new Map(promos.map((p) => [p.promocao_id, p]));
  const s: Selecao = { prejuizo: [], prazo: [] };
  for (const it of prejuizo) {
    const promo = porId.get(it.promocao_id);
    if (promo) s.prejuizo.push({ promo, item: it });
  }
  for (const promo of promos) {
    const prazo = promo.prazo_adesao ? Date.parse(promo.prazo_adesao) : NaN;
    const verdes = promo.contagem?.convidados_verde ?? 0;
    if (promo.status === 'pending' && Number.isFinite(prazo) && prazo > agoraMs && prazo - agoraMs <= JANELA_PRAZO_MS && verdes > 0) {
      s.prazo.push({ promo, verdes });
    }
  }
  return s;
}

const brl = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function montarMensagemPromocoes(s: Selecao): string {
  const partes: string[] = [];
  if (s.prejuizo.length) {
    partes.push(`🔴 Promoções: ${s.prejuizo.length} anúncio(s) participando com líquido abaixo do custo`);
    for (const { promo, item } of s.prejuizo.slice(0, MAX_LISTADOS)) {
      const pior = item.projecao.filter((p) => p.liquido != null && p.custo != null && p.liquido < p.custo)
        .sort((a, b) => (a.liquido! - a.custo!) - (b.liquido! - b.custo!))[0];
      partes.push(`• ${item.titulo ?? item.ml_item_id} (${item.ml_item_id}) em ${promo.nome ?? promo.promocao_id}: ` +
        `preço ${brl(item.preco_avaliado)}, líquido ${brl(pior?.liquido)}, custo ${brl(pior?.custo)}`);
    }
    if (s.prejuizo.length > MAX_LISTADOS) partes.push(`e mais ${s.prejuizo.length - MAX_LISTADOS}.`);
  }
  for (const { promo, verdes } of s.prazo) {
    const prazo = new Date(promo.prazo_adesao!).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    partes.push(`⏰ ${promo.nome ?? promo.promocao_id}: adesão até ${prazo}, ${verdes} anúncio(s) convidado(s) com líquido acima do mínimo.`);
  }
  partes.push('Veja em Promoções no PubliAI.');
  return partes.join('\n');
}

export async function avisarPromocoes(agoraMs: number, deps: DepsAlertas): Promise<number> {
  if (!(await deps.ativo())) return 0;
  const s = selecionarAlertas(await deps.lerPromocoes(), await deps.lerParticipandoNoPrejuizo(), agoraMs);
  const novos: Selecao = { prejuizo: [], prazo: [] };
  for (const x of s.prejuizo) {
    if (await deps.reservar('promo_prejuizo', `${x.promo.promocao_id}:${x.item.ml_item_id}`)) novos.prejuizo.push(x);
  }
  for (const x of s.prazo) {
    if (await deps.reservar('promo_prazo', x.promo.promocao_id)) novos.prazo.push(x);
  }
  if (!novos.prejuizo.length && !novos.prazo.length) return 0;
  return deps.notificar(montarMensagemPromocoes(novos));
}

export function depsAlertas(admin: SupabaseClient, orgId: string): DepsAlertas {
  return {
    async ativo() {
      const { data, error } = await admin.from('configuracoes')
        .select('alertas_promocoes_ativo').eq('org_id', orgId).maybeSingle();
      if (error) throw new Error(`alertas_promocoes_ativo: ${error.message}`);
      return data?.alertas_promocoes_ativo === true;
    },
    async lerPromocoes() {
      const { data, error } = await admin.from('ml_promocoes')
        .select('promocao_id, nome, status, prazo_adesao, contagem')
        .eq('org_id', orgId).in('status', ['pending', 'started']);
      if (error) throw new Error(`lerPromocoes: ${error.message}`);
      return (data ?? []) as PromoAlerta[];
    },
    async lerParticipandoNoPrejuizo() {
      const { data, error } = await admin.from('ml_promocao_itens')
        .select('promocao_id, ml_item_id, titulo, preco_avaliado, projecao')
        .eq('org_id', orgId).in('status', ['started', 'pending']).eq('pior_semaforo', 'vermelho').limit(500);
      if (error) throw new Error(`lerParticipandoNoPrejuizo: ${error.message}`);
      return (data ?? []) as ItemAlerta[];
    },
    reservar: (entidade, chave) => reservarNotificacao(admin, orgId, null, entidade, chave),
    notificar: (texto) => notificarCategoria(admin, orgId, 'financeiro', texto),
  };
}
