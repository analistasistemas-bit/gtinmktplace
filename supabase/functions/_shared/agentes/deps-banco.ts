// Acesso de agentes (ADR-0210, fatia 1): leituras e escritas no banco da edge `agentes`. A edge roda com service
// role (RLS não protege): toda consulta de domínio leva o `orgId` da conexão autenticada. Erro de leitura LANÇA.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { montarPublicados } from '../ads/campanhas.ts';
import type { Candidato, DepsAlvo, Vinculo } from './alvo.ts';
import type { LinhaConexao } from './credencial.ts';

type Filtro = Parameters<DepsAlvo['vinculos']>[0];
type Res<T> = { data: T | null; error: { message: string } | null };

const LIMITE = 200;
const MAX_TITULO = 11;

function dado<T>(onde: string, r: Res<T>): T | null {
  if (r.error) throw new Error(`agentes.${onde}`);
  return r.data;
}
// Embed many-to-one pode vir como objeto ou array conforme o tipo inferido.
const um = <T>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

/** Filhos ativos (cor não retirada) de anúncio ML publicado da org. */
const filhosPublicados = (admin: SupabaseClient, orgId: string, colunas: string) =>
  admin.from('anuncios_externos_itens').select(`${colunas}, anuncios_externos!inner(codigo_pai)`)
    .eq('org_id', orgId).eq('retirado', false).not('item_externo_id', 'is', null)
    .eq('anuncios_externos.canal', 'mercado_livre').eq('anuncios_externos.status', 'publicado');
const paisPublicados = (admin: SupabaseClient, orgId: string, colunas: string) =>
  admin.from('anuncios_externos').select(colunas)
    .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('status', 'publicado').not('item_externo_id', 'is', null);

type LinhaFilho = {
  item_externo_id: string; user_product_id: string | null; family_id: string | null; sku: string;
  anuncios_externos: { codigo_pai: string } | { codigo_pai: string }[] | null;
};

/** Vínculos por MLB, MLBU, família do ML ou SKU (sempre igualdade exata). MLB também casa o anúncio pai sem
 *  filhos; nele o SKU é o próprio `codigo_pai` (produto único, ADR-0191). */
export async function vinculos(admin: SupabaseClient, orgId: string, f: Filtro): Promise<Vinculo[]> {
  const coluna = f.mlb != null ? 'item_externo_id' : f.mlbu != null ? 'user_product_id'
    : f.familia_ml != null ? 'family_id' : f.sku != null ? 'sku' : null;
  const valor = f.mlb ?? f.mlbu ?? f.familia_ml ?? f.sku;
  if (!coluna || valor == null) return [];
  const filhos = dado('vinculos.filhos', await filhosPublicados(admin, orgId, 'item_externo_id, user_product_id, family_id, sku')
    .eq(coluna, valor).limit(LIMITE) as Res<LinhaFilho[]>) ?? [];
  const out: Vinculo[] = [];
  for (const l of filhos) {
    const pai = um(l.anuncios_externos);
    if (pai) {
      out.push({ mlb: l.item_externo_id, mlbu: l.user_product_id, familia_ml: l.family_id, sku: l.sku, codigo_pai: pai.codigo_pai });
    }
  }
  if (f.mlb != null) {
    const pais = dado('vinculos.pais', await paisPublicados(admin, orgId, 'item_externo_id, codigo_pai')
      .eq('item_externo_id', f.mlb).limit(LIMITE) as Res<{ item_externo_id: string; codigo_pai: string }[]>) ?? [];
    for (const p of pais) {
      out.push({ mlb: p.item_externo_id, mlbu: null, familia_ml: null, sku: p.codigo_pai, codigo_pai: p.codigo_pai });
    }
  }
  return out;
}

/** Trecho do título (`familias.nome_pai`) → candidatos com os MLBs publicados de cada código pai da org. */
export async function buscarPorTitulo(admin: SupabaseClient, orgId: string, trecho: string): Promise<Candidato[]> {
  // `\` primeiro: senão escaparia a barra dos outros escapes.
  const padrao = `%${trecho.replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&')}%`;
  const fams = dado('titulo.familias', await admin.from('familias').select('codigo_pai, nome_pai')
    .eq('org_id', orgId).ilike('nome_pai', padrao).order('codigo_pai').limit(MAX_TITULO) as
    Res<{ codigo_pai: string; nome_pai: string }[]>) ?? [];
  // `familias` é por lote: o mesmo código pai se repete; fica o primeiro título.
  const titulos = new Map<string, string>();
  for (const f of fams) if (!titulos.has(f.codigo_pai)) titulos.set(f.codigo_pai, f.nome_pai);
  if (!titulos.size) return [];
  const pais = dado('titulo.pais', await paisPublicados(admin, orgId, 'id, codigo_pai, item_externo_id')
    .in('codigo_pai', [...titulos.keys()]).limit(LIMITE) as
    Res<{ id: string; codigo_pai: string; item_externo_id: string | null }[]>) ?? [];
  const filhos = pais.length
    ? dado('titulo.filhos', await admin.from('anuncios_externos_itens').select('anuncio_externo_id, item_externo_id')
      .eq('org_id', orgId).eq('retirado', false).not('item_externo_id', 'is', null)
      .in('anuncio_externo_id', pais.map((p) => p.id)).limit(LIMITE) as
      Res<{ anuncio_externo_id: string; item_externo_id: string | null }[]>) ?? []
    : [];
  const mlbs = montarPublicados(pais, filhos);
  return [...titulos].filter(([c]) => mlbs[c]?.length).map(([codigo_pai, titulo]) => ({ codigo_pai, titulo, mlbs: mlbs[codigo_pai] }));
}

/** Até `limite` MLBs distintos de uma fonte acima de `depois`. A fonte repete MLB (legado: uma linha por cor),
 *  então pagina com `gt` no último visto até juntar `limite` distintos ou acabar. */
async function distintosAcima(
  pagina: (depois: string | null) => PromiseLike<Res<{ item_externo_id: string }[]>>, depois: string | null, limite: number,
): Promise<Set<string>> {
  const vistos = new Set<string>();
  let cursor = depois;
  while (vistos.size < limite) {
    const linhas = dado('listarMlbs', await pagina(cursor)) ?? [];
    for (const l of linhas) vistos.add(l.item_externo_id);
    if (linhas.length < limite) break;
    cursor = linhas[linhas.length - 1].item_externo_id;
  }
  return vistos;
}

/** MLBs distintos publicados da org, crescentes (comparação de texto, igual no banco e aqui), maiores que `depois`. */
export async function listarMlbs(admin: SupabaseClient, orgId: string, depois: string | null, limite: number): Promise<string[]> {
  const [pais, filhos] = await Promise.all([
    distintosAcima((d) => {
      const q = paisPublicados(admin, orgId, 'item_externo_id');
      return (d == null ? q : q.gt('item_externo_id', d)).order('item_externo_id').limit(limite) as never;
    }, depois, limite),
    distintosAcima((d) => {
      const q = filhosPublicados(admin, orgId, 'item_externo_id');
      return (d == null ? q : q.gt('item_externo_id', d)).order('item_externo_id').limit(limite) as never;
    }, depois, limite),
  ]);
  return [...new Set([...pais, ...filhos])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, limite);
}

/** Única consulta sem org: a org ainda é desconhecida e sai daqui. */
export async function buscarConexaoPorHash(admin: SupabaseClient, hash: string): Promise<LinhaConexao | null> {
  return dado('conexao', await admin.from('agente_conexoes').select('id, org_id, expira_em, revogada_em')
    .eq('hash', hash).maybeSingle() as Res<LinhaConexao>);
}

/** Org existe, não está arquivada e tem o módulo `agentes`. Erro de leitura lança (a autenticação responde 503). */
export async function orgAtivaComModulo(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const org = dado('org', await admin.from('organizations').select('modulos_habilitados, arquivada_em')
    .eq('id', orgId).maybeSingle() as Res<{ modulos_habilitados: string[] | null; arquivada_em: string | null }>);
  return !!org && org.arquivada_em == null && (org.modulos_habilitados ?? []).includes('agentes');
}

export async function marcarUso(admin: SupabaseClient, orgId: string, conexaoId: string, agora: Date): Promise<void> {
  dado('marcarUso', await admin.from('agente_conexoes').update({ ultimo_uso_em: agora.toISOString() })
    .eq('org_id', orgId).eq('id', conexaoId) as Res<unknown>);
}

export async function gravarChamada(admin: SupabaseClient, c: {
  orgId: string; conexaoId: string; ferramenta: string; alvo: string | null; resultado: string;
}): Promise<void> {
  dado('gravarChamada', await admin.from('agente_chamadas').insert({
    org_id: c.orgId, conexao_id: c.conexaoId, ferramenta: c.ferramenta, alvo: c.alvo, resultado: c.resultado,
  }) as Res<unknown>);
}

/** Nome da org e apelido (`conta_label`) da conta ML; sem apelido guardado, o id da conta; sem conexão, null. */
export async function lerLoja(admin: SupabaseClient, orgId: string): Promise<{ organizacao: string | null; conta_ml: string | null }> {
  const [org, cx] = await Promise.all([
    admin.from('organizations').select('nome').eq('id', orgId).maybeSingle(),
    admin.from('marketplace_connections').select('conta_label, conta_externa_id')
      .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle(),
  ]);
  const o = dado('loja.org', org as Res<{ nome: string }>);
  const c = dado('loja.conexao', cx as Res<{ conta_label: string | null; conta_externa_id: string | null }>);
  return { organizacao: o?.nome ?? null, conta_ml: c?.conta_label ?? c?.conta_externa_id ?? null };
}
