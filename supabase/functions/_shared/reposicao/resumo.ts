// Foto diária e "Resumo de reposição" (ADR-0207 §17–§18). Texto puro + gravação idempotente da foto.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ResultadoReposicao, SugestaoSku, Urgencia } from './calculo.ts';
import type { FamiliaTela, PedidoDTO, SkuTela } from './tipos.ts';

const ORDEM: Urgencia[] = ['ruptura', 'vai_faltar', 'pedir_agora', 'em_dia'];
const ROTULO: Record<Urgencia, string> = {
  ruptura: 'Em ruptura', vai_faltar: 'Vai faltar antes da chegada', pedir_agora: 'Pedir agora', em_dia: 'Em dia',
};
const LOTE = 500;
const MAX_PRODUTOS = 15;

/** Só o dia corrente (BRT) grava foto e avisa: replay de dia passado reescreveria a história de acurácia. */
export const deveProcessar = (dia: string, hojeBrt: string): boolean => dia === hojeBrt;

/** Nome e cor/tamanho dos SKUs (do `lerDados`); sem ele o texto cai no código. */
export interface CatalogoResumo { skus: Pick<SkuTela, 'codigo' | 'codigoPai' | 'cor' | 'tamanho'>[]; familias: Pick<FamiliaTela, 'codigoPai' | 'nome'>[] }

/** null = sem novidade. `anterior` = urgências da foto mais recente antes de hoje (ausente = novo). */
export function montarResumo(
  hoje: SugestaoSku[], anterior: Map<string, Urgencia>, atrasados: PedidoDTO[], rascunhosEsperando: number,
  catalogo: CatalogoResumo = { skus: [], familias: [] },
): string | null {
  const rank = (u: Urgencia) => ORDEM.indexOf(u);
  const novos = hoje.filter((s) => rank(s.urgencia) < rank('em_dia')
    && rank(s.urgencia) < rank(anterior.get(s.codigo) ?? 'em_dia'));
  if (!novos.length && !atrasados.length) return null;

  const skuPor = new Map(catalogo.skus.map((s) => [s.codigo, s]));
  const nomePor = new Map(catalogo.familias.map((f) => [f.codigoPai, f.nome]));
  const linhas: string[] = ['🛒 Reposição'];
  let listados = 0;
  let omitidos = 0;
  for (const u of ORDEM) {
    const grupos = new Map<string, string[]>();
    for (const s of novos.filter((x) => x.urgencia === u)) {
      const c = skuPor.get(s.codigo);
      const titulo = [nomePor.get(s.codigoPai) ?? s.codigoPai, c?.cor].filter(Boolean).join(' · ');
      grupos.set(titulo, [...(grupos.get(titulo) ?? []), c?.tamanho ?? s.codigo]);
    }
    if (!grupos.size) continue;
    const cabecalho = linhas.length;
    for (const [t, tams] of grupos) {
      if (listados >= MAX_PRODUTOS) { omitidos++; continue; }
      if (linhas.length === cabecalho) linhas.push('', `${ROTULO[u]}:`);
      linhas.push(`• ${t}: ${tams.join(', ')}`);
      listados++;
    }
  }
  if (omitidos) linhas.push('', `e mais ${omitidos} produtos — veja em /#/reposicao`);
  if (atrasados.length) {
    linhas.push('', `Pedidos atrasados: ${atrasados.map((p) => p.fornecedor.nome).join(', ')}`);
  }
  if (rascunhosEsperando) linhas.push('', `${rascunhosEsperando} rascunho(s) de pedido esperando.`);
  const pior = ORDEM.find((u) => novos.some((s) => s.urgencia === u)) ?? 'pedir_agora';
  linhas.push('', `/#/reposicao?urgencia=${pior}`);
  return linhas.join('\n');
}

/** Upsert idempotente pela pk (org, dia, codigo). */
export async function gravarFoto(admin: SupabaseClient, orgId: string, dia: string, r: ResultadoReposicao): Promise<void> {
  const linhas = r.skus.map((s) => ({
    org_id: orgId, dia, codigo: s.codigo, codigo_pai: s.codigoPai, estoque: s.estoqueHoje,
    velocidade: s.v, w: s.w, sugestao: s.pedir, urgencia: s.urgencia,
  }));
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin.from('reposicao_fotos').upsert(linhas.slice(i, i + LOTE), { onConflict: 'org_id,dia,codigo' });
    if (error) throw new Error(`reposicao_fotos: ${error.message}`);
  }
}

/** Urgências da foto mais recente com `dia < hoje` (não necessariamente ontem). */
export async function lerFotoAnterior(admin: SupabaseClient, orgId: string, hoje: string): Promise<Map<string, Urgencia>> {
  const { data: ult, error: e1 } = await admin.from('reposicao_fotos').select('dia')
    .eq('org_id', orgId).lt('dia', hoje).order('dia', { ascending: false }).limit(1).maybeSingle();
  if (e1) throw new Error(`reposicao_fotos: ${e1.message}`);
  const m = new Map<string, Urgencia>();
  if (!ult) return m;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('reposicao_fotos').select('codigo, urgencia')
      .eq('org_id', orgId).eq('dia', (ult as { dia: string }).dia).order('codigo').range(de, de + 999);
    if (error) throw new Error(`reposicao_fotos: ${error.message}`);
    for (const r of (data ?? []) as { codigo: string; urgencia: Urgencia }[]) m.set(r.codigo, r.urgencia);
    if ((data ?? []).length < 1000) return m;
  }
}
