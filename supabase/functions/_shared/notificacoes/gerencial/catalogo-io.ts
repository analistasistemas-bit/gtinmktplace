// Catálogo de estoque/família por código (ADR-0190; ADR-0193 D-7 reusa no relatório mensal). Módulo
// leve de propósito: só Postgres, sem QStash — a edge platform-admin importa daqui.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { lerPaginas, type MetricsDb } from '../../platform-admin/metrics-repository.ts';
import type { CatalogoEstoque } from './estoque-acabando.ts';

type Consulta = ReturnType<MetricsDb['from']>;
const LOTE_CATALOGO = 50;

async function paginas(build: () => unknown, rotulo: string): Promise<Record<string, unknown>[]> {
  const { rows, error } = await lerPaginas(build as () => Consulta);
  if (error) throw new Error(`${rotulo}: ${error.message}`);
  return rows;
}

/** Catálogo de estoque por código. Canônica = família mais nova (`criado_em desc, id desc`), como
 *  `vendas_sku_catalogo`; `nome` = nome da variação ou, sem ele, o da família. Erro de leitura → lança. */
export async function lerCatalogoEstoque(
  admin: SupabaseClient, orgId: string, codigos: string[],
): Promise<Map<string, CatalogoEstoque>> {
  type Linha = {
    codigo: string; nome: string | null; estoque: number | null;
    familias: { nome_pai: string | null; codigo_pai: string | null; kit_multiplicador: number | null; criado_em: string; id: string };
  };
  const catalogo = new Map<string, CatalogoEstoque>();
  const canonica = new Map<string, Linha['familias']>();
  for (let i = 0; i < codigos.length; i += LOTE_CATALOGO) {
    // paginado por `id` (único): reimportações podem passar de 1.000 linhas por lote (max_rows)
    const data = await paginas(() => admin.from('variacoes')
      .select('codigo, nome, estoque, familias!inner(nome_pai, codigo_pai, kit_multiplicador, criado_em, id)')
      .eq('org_id', orgId).eq('familias.org_id', orgId).in('codigo', codigos.slice(i, i + LOTE_CATALOGO))
      .order('id', { ascending: true }), 'catálogo de estoque');
    for (const r of data as unknown as Linha[]) {
      const f = r.familias, atual = canonica.get(r.codigo);
      // ponytail: a ordenação do PostgREST não vale para embed 1:1; escolhe a mais nova em memória
      if (atual && (atual.criado_em > f.criado_em || (atual.criado_em === f.criado_em && atual.id > f.id))) continue;
      canonica.set(r.codigo, f);
      catalogo.set(r.codigo, {
        codigo: r.codigo, estoque: r.estoque == null ? null : Number(r.estoque), ehKit: f.kit_multiplicador != null,
        nome: r.nome ?? f.nome_pai, nomeFamilia: f.nome_pai, codigoPai: f.codigo_pai ?? null,
      });
    }
  }
  return catalogo;
}
