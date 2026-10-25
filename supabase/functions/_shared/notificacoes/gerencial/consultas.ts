// Consultas estruturadas do bot (ADR-0190 D-9): compartilhadas entre os comandos da v1 e a IA da
// fase 2. Toda consulta devolve período, fuso e "apurado em" junto dos dados; não dependem de
// sessão/RLS do front. `VolumeAcimaDoLimite` se propaga (o worker responde TEXTO_VOLUME).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { carregarContexto, lerVendasJanela, type MetricsDb } from '../../platform-admin/metrics-repository.ts';
import { diaBrt, janelaDia, janelasMesCorrente, type JanelaIso } from './janelas.ts';
import { lerKpis } from './kpis.ts';
import type { DadosResumo, KpisPeriodo } from './mensagens.ts';
import { lucroDoPeriodo, resultadoPorItem, topPorLucro, type LucroPeriodo, type ResultadoItem } from './resultado.ts';
import { montarDadosResumo } from './resumo-io.ts';

const DIA_MS = 86_400_000;

interface Base { periodo: JanelaIso; fuso: 'America/Sao_Paulo'; apuradoEm: string }
const base = (periodo: JanelaIso, agora: Date): Base => ({ periodo, fuso: 'America/Sao_Paulo', apuradoEm: agora.toISOString() });

async function kpisPeriodo(admin: SupabaseClient, orgId: string, agora: Date): Promise<KpisPeriodo> {
  const jm = janelasMesCorrente(agora);
  const [hoje, mes, anterior] = await Promise.all([
    lerKpis(admin, orgId, janelaDia(diaBrt(agora))), lerKpis(admin, orgId, jm.mes), lerKpis(admin, orgId, jm.anterior),
  ]);
  return { hoje, mes, anterior, rotuloMes: jm.rotuloMes, rotuloAnterior: jm.rotuloAnterior };
}

async function itensDaJanela(admin: SupabaseClient, orgId: string, j: JanelaIso): Promise<{ itens: ResultadoItem[]; configOk: boolean }> {
  const db = admin as unknown as MetricsDb;
  const [ctx, vendas] = await Promise.all([carregarContexto(db, orgId, j.desde), lerVendasJanela(db, orgId, j)]);
  return { itens: resultadoPorItem(vendas, ctx), configOk: ctx.configOk };
}

export async function consultarHoje(admin: SupabaseClient, orgId: string, agora: Date): Promise<Base & { k: KpisPeriodo; l: LucroPeriodo }> {
  const periodo = janelaDia(diaBrt(agora));
  const [k, r] = await Promise.all([kpisPeriodo(admin, orgId, agora), itensDaJanela(admin, orgId, periodo)]);
  return { ...base(periodo, agora), k, l: lucroDoPeriodo(r.itens, r.configOk) };
}

export async function consultarMes(admin: SupabaseClient, orgId: string, agora: Date): Promise<Base & { k: KpisPeriodo; l: LucroPeriodo }> {
  const periodo = janelasMesCorrente(agora).mes;
  const [k, r] = await Promise.all([kpisPeriodo(admin, orgId, agora), itensDaJanela(admin, orgId, periodo)]);
  return { ...base(periodo, agora), k, l: lucroDoPeriodo(r.itens, r.configOk) };
}

export async function consultarTop(
  admin: SupabaseClient, orgId: string, agora: Date, n = 5,
): Promise<Base & { top: { titulo: string; lucro: number }[]; cobertura: LucroPeriodo; rotuloMes: string }> {
  const jm = janelasMesCorrente(agora);
  const r = await itensDaJanela(admin, orgId, jm.mes);
  return { ...base(jm.mes, agora), top: topPorLucro(r.itens, n), cobertura: lucroDoPeriodo(r.itens, r.configOk), rotuloMes: jm.rotuloMes };
}

/** Dia anterior fechado (BRT), com os mesmos dados do resumo diário. */
export async function consultarOntem(admin: SupabaseClient, orgId: string, agora: Date): Promise<Base & { dados: DadosResumo }> {
  const dia = diaBrt(new Date(agora.getTime() - DIA_MS));
  return { ...base(janelaDia(dia), agora), dados: await montarDadosResumo(admin, orgId, dia, agora) };
}
