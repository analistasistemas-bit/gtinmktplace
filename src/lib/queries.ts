import { supabase } from './supabase';
import { signedUrl } from './storage';
import { useAuthStore } from '@/stores/auth-store';
import type { Database } from './database.types';
import type {
  Lote,
  Familia,
  FamiliaStatus,
  Variacao,
  LoteStatus,
  OperacaoML,
  EstrategiaPreco,
  Concorrencia,
  AnaliseMercado,
  AtributoMl,
  CampoFaltante,
  CategoriaCandidata,
} from './tipos-dominio';
import { parseAnomalias, parseMudancaEstrutural } from './tipos-dominio';
import type { FaixaAtacado } from './atacado';
import type { PublicadoItem, StatusPublicado } from './publicados';
import { dedupePublicados } from './publicados';

export const QK = {
  lotes: (userId: string) => ['lotes', userId] as const,
  lote: (loteId: string) => ['lote', loteId] as const,
  familias: (loteId: string) => ['familias', loteId] as const,
  familiasResumo: (loteId: string) => ['familias-resumo', loteId] as const,
  familia: (familiaId: string) => ['familia', familiaId] as const,
  publicados: ['publicados'] as const,
  statusPublicados: ['statusPublicados'] as const,
  conexoes: ['conexoes'] as const,
  canaisHabilitados: ['canais-habilitados'] as const,
};

export type LoteRow = Database['public']['Tables']['lotes']['Row'];
export type FamiliaRow = Database['public']['Tables']['familias']['Row'];
export type VariacaoRow = Database['public']['Tables']['variacoes']['Row'];

export async function fetchLotes(): Promise<LoteRow[]> {
  const { data, error } = await supabase
    .from('lotes')
    .select('*')
    .order('criado_em', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchLote(id: string): Promise<LoteRow | null> {
  const { data, error } = await supabase
    .from('lotes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Anúncio (partição) de um produto em anuncios_externos — campos usados pela UI. */
export type AnuncioExternoLite = {
  codigo_pai: string;
  particao: number;
  permalink: string | null;
  titulo: string | null;
};

// Split (ADR-0048): um produto pode ter N anúncios (partições) em anuncios_externos;
// familias.ml_permalink só carrega a partição 0. Busca os demais por codigo_pai (RLS filtra
// pelo usuário) para a UI mostrar todos os anúncios do produto.
async function fetchAnunciosPorCodigoPai(codigosPai: string[]): Promise<Map<string, AnuncioExternoLite[]>> {
  const porCodigo = new Map<string, AnuncioExternoLite[]>();
  if (codigosPai.length === 0) return porCodigo;
  const { data: anuncios } = await supabase
    .from('anuncios_externos')
    .select('codigo_pai, particao, permalink, titulo')
    .eq('canal', 'mercado_livre')
    .in('codigo_pai', codigosPai);
  for (const a of (anuncios ?? []) as AnuncioExternoLite[]) {
    const lista = porCodigo.get(a.codigo_pai) ?? [];
    lista.push(a);
    porCodigo.set(a.codigo_pai, lista);
  }
  return porCodigo;
}

export async function fetchFamilias(
  loteId: string
): Promise<(FamiliaRow & { variacoes: VariacaoRow[]; anuncios_externos: AnuncioExternoLite[] })[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('*, variacoes(*)')
    .eq('lote_id', loteId)
    .order('codigo_pai');
  if (error) throw error;
  const familias = (data ?? []) as (FamiliaRow & { variacoes: VariacaoRow[] })[];

  const codigosPai = [...new Set(familias.map((f) => f.codigo_pai))];
  const porCodigo = await fetchAnunciosPorCodigoPai(codigosPai);
  return familias.map((f) => ({
    ...f,
    anuncios_externos: (porCodigo.get(f.codigo_pai) ?? []).sort((a, b) => a.particao - b.particao),
  }));
}

/** Campos mínimos p/ as telas de acompanhamento (Progresso/Relatorio) — poll de 2,5s durante
 *  processamento/publicação; o select enxuto corta ~98% do payload do tick. */
export type FamiliaResumo = {
  id: string; codigoPai: string; titulo: string; status: FamiliaStatus;
  erroMensagem: string | null; mlPermalink: string | null;
  anuncios: { particao: number; permalink: string | null; titulo: string | null }[];
};

type FamiliaResumoRow = Pick<FamiliaRow, 'id' | 'codigo_pai' | 'titulo_ml' | 'nome_pai' | 'status' | 'erro_mensagem' | 'ml_permalink'>;

export function familiaResumoFromRow(r: FamiliaResumoRow, anuncios: AnuncioExternoLite[]): FamiliaResumo {
  return {
    id: r.id,
    codigoPai: r.codigo_pai,
    titulo: r.titulo_ml ?? r.nome_pai,
    status: r.status as FamiliaStatus,
    erroMensagem: r.erro_mensagem,
    mlPermalink: r.ml_permalink,
    anuncios: [...anuncios].sort((a, b) => a.particao - b.particao)
      .map((a) => ({ particao: a.particao, permalink: a.permalink, titulo: a.titulo })),
  };
}

export async function fetchFamiliasResumo(loteId: string): Promise<FamiliaResumo[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, codigo_pai, titulo_ml, nome_pai, status, erro_mensagem, ml_permalink')
    .eq('lote_id', loteId)
    .order('codigo_pai');
  if (error) throw error;
  const rows = (data ?? []) as FamiliaResumoRow[];
  const porCodigo = await fetchAnunciosPorCodigoPai([...new Set(rows.map((r) => r.codigo_pai))]);
  return rows.map((r) => familiaResumoFromRow(r, porCodigo.get(r.codigo_pai) ?? []));
}

// Carrega UMA família (com variações) por id e mapeia para o tipo de domínio. Usado pelo
// expandir de Publicados, que precisa da análise completa (estratégia, concorrência, custo).
export async function fetchFamiliaPublicada(familiaId: string): Promise<Familia> {
  const { data, error } = await supabase
    .from('familias')
    .select('*, variacoes(*)')
    .eq('id', familiaId)
    .single();
  if (error) throw error;
  return familiaFromRow(data as FamiliaRow & { variacoes: VariacaoRow[] });
}

// ============================================================================
// Adapters DB -> tipos do M1 (camelCase)
// ============================================================================

// O DB usa enums em lowercase (proprio, competitivo) e o M1 usa UPPERCASE
// (PROPRIO, COMPETITIVO). Mapeamento isolado abaixo.
function mapEstrategiaPreco(
  v: Database['public']['Enums']['estrategia_preco'] | null
): EstrategiaPreco {
  if (v === 'competitivo') return 'COMPETITIVO';
  // 'proprio' e 'manual' caem em PROPRIO como default seguro do M2
  return 'PROPRIO';
}

function mapConcorrenciaClasse(
  v: Database['public']['Enums']['classe_concorrencia'] | null
): Concorrencia {
  return v ?? 'sem';
}

export function loteFromRow(r: LoteRow): Lote {
  return {
    id: r.id,
    numero: r.numero_org ?? r.numero,
    criadoEm: r.criado_em,
    status: r.status as LoteStatus,
    totalFamilias: r.total_familias,
    totalPublicadas: r.total_publicadas,
    totalErros: r.total_erros,
    anomalias: parseAnomalias(r.anomalias_planilha),
  };
}

export function variacaoFromRow(r: VariacaoRow): Variacao {
  return {
    id: r.id,
    codigo: r.codigo,
    cor: r.cor ?? '',
    corHex: r.cor_hex ?? '#cccccc',
    corOrigem: r.cor_origem,
    corEditadaPeloOperador: r.cor_editada_pelo_operador,
    preco: Number(r.preco),
    precoPublicacao: r.preco_publicacao != null ? Number(r.preco_publicacao) : null,
    precoPublicadoMl: r.preco_publicado_ml != null ? Number(r.preco_publicado_ml) : null,
    estoque: r.estoque,
    gtin: r.gtin,
    fotoPath: r.imagem_path ?? undefined,
    editadoPeloOperador: r.preco_editado_pelo_operador,
    excluidaDaPublicacao: r.excluida_da_publicacao,
    mlVariationId: r.ml_variation_id,
    estoqueAnterior: r.estoque_anterior,
    custo: r.custo != null ? Number(r.custo) : null,
    pesoGramas: r.peso_gramas != null ? Number(r.peso_gramas) : null,
    alturaCm: r.altura_cm != null ? Number(r.altura_cm) : null,
    larguraCm: r.largura_cm != null ? Number(r.largura_cm) : null,
    comprimentoCm: r.comprimento_cm != null ? Number(r.comprimento_cm) : null,
    exibirComDesconto: r.exibir_com_desconto,
    descontoPct: r.desconto_pct != null ? Number(r.desconto_pct) : null,
    atacado: Array.isArray(r.atacado) ? (r.atacado as unknown as FaixaAtacado[]) : null,
  };
}

// ============================================================================
// Mutations: edição inline persiste no banco
// ============================================================================

export async function updateVariacaoPreco(
  variacaoId: string,
  novoPreco: number
): Promise<void> {
  const { error } = await supabase
    .from('variacoes')
    .update({
      preco_publicacao: novoPreco,
      preco_editado_pelo_operador: true,
    })
    .eq('id', variacaoId);
  if (error) throw error;
}

export async function updateFamiliaTitulo(
  familiaId: string,
  novoTitulo: string
): Promise<void> {
  const { error } = await supabase
    .from('familias')
    .update({
      titulo_ml: novoTitulo,
      titulo_editado_pelo_operador: true,
    })
    .eq('id', familiaId);
  if (error) throw error;
}

export async function updateFamiliaDescricao(
  familiaId: string,
  novaDescricao: string
): Promise<void> {
  const { error } = await supabase
    .from('familias')
    .update({
      descricao_ml: novaDescricao,
      descricao_editada_pelo_operador: true,
    })
    .eq('id', familiaId);
  if (error) throw error;
}

export async function updateVariacaoPrincipal(familiaId: string, codigo: string): Promise<void> {
  const { error } = await supabase
    .from('familias')
    .update({ variacao_principal_codigo: codigo })
    .eq('id', familiaId);
  if (error) throw error;
}

export async function updateVariacaoCor(
  variacaoId: string,
  codigo: string,
  novaCor: string
): Promise<void> {
  const { error } = await supabase
    .from('variacoes')
    .update({
      cor: novaCor,
      cor_origem: 'manual',
      cor_editada_pelo_operador: true,
    })
    .eq('id', variacaoId);
  if (error) throw error;

  // Invalida cache Redis (não bloqueante — se Redis falhar, log mas segue)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invalidar-cache-cor`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ codigo }),
        }
      );
    }
  } catch (e) {
    console.warn('Invalidação de cache falhou (não bloqueante):', e);
  }
}

export async function updateVariacaoGtin(
  variacaoId: string,
  gtin: string | null
): Promise<void> {
  const { error } = await supabase
    .from('variacoes')
    .update({ gtin })
    .eq('id', variacaoId);
  if (error) throw error;
}

// ============================================================================
// Storage helpers
// ============================================================================

/** Gera URL assinada (1h) para a capa de uma família. Retorna null se não há path. */
export async function urlCapaFamilia(capaStoragePath: string | null | undefined): Promise<string | null> {
  if (!capaStoragePath) return null;
  try {
    return await signedUrl('imagens', capaStoragePath, 60 * 60);
  } catch {
    return null;
  }
}

// Camada 2B (ADR-0052): fallback de atributos via edge function atributos-familia.
async function chamarAtributosFamilia(body: Record<string, unknown>): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/atributos-familia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || `Erro ${res.status}`);
  return res;
}

export async function listarFaltantesAtributos(familiaId: string): Promise<CampoFaltante[]> {
  const res = await chamarAtributosFamilia({ action: 'faltantes', familia_id: familiaId });
  const json = await res.json() as { campos: CampoFaltante[] };
  return json.campos;
}

export async function salvarAtributoFamilia(familiaId: string, atributoId: string, valor: string): Promise<string[]> {
  const res = await chamarAtributosFamilia({ action: 'salvar', familia_id: familiaId, atributo_id: atributoId, valor });
  const json = await res.json() as { atributos_faltantes: string[] };
  return json.atributos_faltantes;
}

export async function buscarCategoriaML(
  familiaId: string, query: string,
): Promise<{ candidatos: CategoriaCandidata[]; sugestaoConcorrente: CategoriaCandidata | null }> {
  const res = await chamarAtributosFamilia({ action: 'buscar-categoria', familia_id: familiaId, query });
  return res.json();
}

export function familiaFromRow(
  r: FamiliaRow & {
    variacoes: VariacaoRow[];
    anuncios_externos?: AnuncioExternoLite[];
    // ponytail: coluna aditiva (ADR-0065) — database.types.ts ainda não regenerado (db push pendente).
    preco_reancorado_lider?: boolean;
  }
): Familia {
  const variacoes = r.variacoes.map(variacaoFromRow);
  const precos = variacoes.map((v) => v.preco);
  const precoMin = precos.length > 0 ? Math.min(...precos) : 0;
  const precoMax = precos.length > 0 ? Math.max(...precos) : 0;

  // Alerta de preço perigoso (gap §556): alguma variação cujo preço de publicação
  // ficou mais de 20% abaixo do preço da planilha.
  const precoAbaixo20pc = variacoes.some(
    (v) => v.precoPublicacao != null && v.preco > 0 && v.precoPublicacao < v.preco * 0.8
  );

  return {
    id: r.id,
    loteId: r.lote_id,
    codigoPai: r.codigo_pai,
    titulo: r.titulo_ml ?? r.nome_pai,
    descricao: r.descricao_ml ?? r.descricao_pai ?? '',
    operacao: r.operacao as OperacaoML,
    estrategiaPreco: mapEstrategiaPreco(r.estrategia_preco),
    estrategiaMotivo: r.estrategia_motivo ?? '',
    precoReancoradoLider: r.preco_reancorado_lider ?? false,
    concorrencia: mapConcorrenciaClasse(r.concorrencia_classe),
    concorrenciaVendedores: r.concorrencia_vendedores,
    concorrenciaPrecoMin:
      r.concorrencia_preco_min != null ? Number(r.concorrencia_preco_min) : null,
    analiseMercado: (r.analise_mercado as AnaliseMercado | null) ?? null,
    tipoAviamento: r.tipo_aviamento,
    categoriaMlId: r.categoria_ml_id,
    categoriaNome: r.categoria_nome,
    tipoOrigem: r.tipo_origem,
    concorrenciaCategoriaId: r.concorrencia_categoria_id,
    origem: r.origem,
    atributosFaltantes: (r.atributos_faltantes as string[] | null) ?? null,
    atributosMl: (r.atributos_ml as AtributoMl[] | null) ?? [],
    precoMin,
    precoMax,
    precoAbaixo20pc,
    fotoCapaPath: variacoes.find((v) => v.fotoPath)?.fotoPath,
    capaStoragePath: r.capa_storage_path,
    capa2StoragePath: r.capa2_storage_path,
    capa3StoragePath: r.capa3_storage_path,
    variacaoPrincipalCodigo: r.variacao_principal_codigo,
    variacoes,
    editadoPeloOperador:
      r.titulo_editado_pelo_operador || r.descricao_editada_pelo_operador,
    status: r.status as FamiliaStatus,
    tokensInput: r.tokens_input,
    tokensOutput: r.tokens_output,
    custoCentavos: r.custo_centavos,
    tituloEditadoPeloOperador: r.titulo_editado_pelo_operador,
    descricaoEditadaPeloOperador: r.descricao_editada_pelo_operador,
    // Selo "X sem cor" do pai: só conta o que vai virar variação no ML e precisa de
    // cor — estoque 0 (dorme até repor) e cores excluídas não geram pendência.
    variacoesSemCor: variacoes.filter((v) => !v.cor && v.estoque > 0 && !v.excluidaDaPublicacao).length,
    mlPermalink: r.ml_permalink,
    mlItemId: r.ml_item_id,
    anuncios: (r.anuncios_externos ?? []).map((a) => ({
      particao: a.particao, permalink: a.permalink, titulo: a.titulo,
    })),
    mudancaEstrutural: parseMudancaEstrutural(r.mudanca_estrutural),
    erroMensagem: r.erro_mensagem,
    exibirComDesconto: r.exibir_com_desconto,
    descontoPct: r.desconto_pct != null ? Number(r.desconto_pct) : null,
    atacado: Array.isArray(r.atacado) ? (r.atacado as unknown as FaixaAtacado[]) : null,
    atacadoStatus: r.atacado_status ?? null,
    atacadoErro: r.atacado_erro ?? null,
  };
}

export async function fetchDescontoPct(): Promise<number> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return 15;
  const { data } = await supabase.from('configuracoes')
    .select('desconto_pct').eq('org_id', orgId).maybeSingle();
  return data?.desconto_pct != null ? Number(data.desconto_pct) : 15;
}

export async function upsertDescontoPct(pct: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, desconto_pct: pct, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchAliquotas(): Promise<{ nacional: number; importado: number; confirmada: boolean }> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return { nacional: 8, importado: 16, confirmada: false };
  const { data } = await supabase.from('configuracoes')
    .select('aliquota_nacional_pct, aliquota_importado_pct, aliquotas_confirmadas_em').eq('org_id', orgId).maybeSingle();
  return {
    nacional: data?.aliquota_nacional_pct != null ? Number(data.aliquota_nacional_pct) : 8,
    importado: data?.aliquota_importado_pct != null ? Number(data.aliquota_importado_pct) : 16,
    // ADR-0086: só é "confirmada" com a flag setada (salvar em Configurações). Sem ela, o
    // process-familia bloqueia a publicação (LOUD) em vez de usar 8/16 em silêncio.
    confirmada: data?.aliquotas_confirmadas_em != null,
  };
}

export async function upsertAliquotas(a: { nacional: number; importado: number }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const agora = new Date().toISOString();
  // Salvar as alíquotas = confirmá-las (ADR-0086): destrava o LOUD do process-familia, que exige
  // confirmação explícita antes de publicar (não precificar com o default 8/16 em silêncio).
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, aliquota_nacional_pct: a.nacional, aliquota_importado_pct: a.importado, aliquotas_confirmadas_em: agora, atualizado_em: agora }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchDescontoConcorrenciaPct(): Promise<number> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return 5;
  const { data } = await supabase.from('configuracoes')
    .select('desconto_concorrencia_pct').eq('org_id', orgId).maybeSingle();
  return data?.desconto_concorrencia_pct != null ? Number(data.desconto_concorrencia_pct) : 5;
}

export async function upsertDescontoConcorrenciaPct(pct: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, desconto_concorrencia_pct: pct, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchReancoraLiderAtiva(): Promise<boolean> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return false;
  const { data } = await supabase.from('configuracoes')
    .select('reancora_lider_ativa').eq('org_id', orgId).maybeSingle();
  return data?.reancora_lider_ativa ?? false;
}

export async function upsertReancoraLiderAtiva(ativa: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, reancora_lider_ativa: ativa, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchMostrarLucroDashboard(): Promise<boolean> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return false;
  const { data } = await supabase.from('configuracoes')
    .select('mostrar_lucro_dashboard').eq('org_id', orgId).maybeSingle();
  return data?.mostrar_lucro_dashboard ?? false;
}

export async function upsertMostrarLucroDashboard(ativo: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, mostrar_lucro_dashboard: ativo, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchModeloTexto(): Promise<string | null> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return null;
  const { data } = await supabase.from('configuracoes')
    .select('ai_model_texto').eq('org_id', orgId).maybeSingle();
  return data?.ai_model_texto ?? null;
}

export async function upsertModeloTexto(slug: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, ai_model_texto: slug, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function fetchModeloImagem(): Promise<string | null> {
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) return null;
  const { data } = await supabase.from('configuracoes')
    .select('ai_model_imagem').eq('org_id', orgId).maybeSingle();
  return data?.ai_model_imagem ?? null;
}

export async function upsertModeloImagem(slug: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!user || !orgId) throw new Error('sem sessão');
  const { error } = await supabase.from('configuracoes')
    .upsert({ org_id: orgId, user_id: user.id, ai_model_imagem: slug, atualizado_em: new Date().toISOString() }, { onConflict: 'org_id' });
  if (error) throw error;
}

export async function updateFamiliaExibirDesconto(familiaId: string, exibir: boolean): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ exibir_com_desconto: exibir }).eq('id', familiaId);
  if (error) throw error;
}

// ── Alertas no Telegram (configuração na tela Configurações) ──────────────────

export interface TelegramConfig {
  chatId: string;
  ativo: boolean;
  temToken: boolean;
}

/** Lê o status via RPC (não devolve o token ao navegador). */
export async function fetchTelegramConfig(): Promise<TelegramConfig> {
  const { data, error } = await supabase.rpc('telegram_config_status');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return {
    chatId: row?.chat_id ?? '',
    ativo: Boolean(row?.ativo),
    temToken: Boolean(row?.tem_token),
  };
}

/** Salva chat_id e ativo; só grava o token quando informado (campo deixado vazio = mantém). */
export async function salvarTelegramConfig(input: { chatId: string; ativo: boolean; botToken?: string }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('sem sessão');
  const orgId = useAuthStore.getState().profile?.org_id;
  if (!orgId) throw new Error('sem organização');
  const tokenLimpo = input.botToken?.trim();
  const { error } = await supabase.from('configuracoes').upsert({
    org_id: orgId,
    user_id: user.id,
    telegram_chat_id: input.chatId || null,
    telegram_ativo: input.ativo,
    atualizado_em: new Date().toISOString(),
    ...(tokenLimpo ? { telegram_bot_token: tokenLimpo } : {}),
  }, { onConflict: 'org_id' });
  if (error) throw error;
}

async function invocarMonitorarModerados(payload: Record<string, unknown>): Promise<{ ok: boolean; novos?: number; erro?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/monitorar-moderados`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    },
  );
  const json = await resp.json().catch(() => ({ ok: false, erro: `Falha (${resp.status})` }));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json;
}

/** Dispara uma mensagem de teste pro Telegram. chatId opcional testa um destinatário
 * específico; sem ele, usa o chat_id salvo em Configurações. */
export function enviarTesteTelegram(chatId?: string): Promise<{ ok: boolean; erro?: string }> {
  return invocarMonitorarModerados({ teste: true, chatId });
}

/** Roda o monitor de moderados na hora, escopado ao usuário logado. */
export function verificarModeradosAgora(): Promise<{ ok: boolean; novos?: number }> {
  return invocarMonitorarModerados({});
}

export async function updateFamiliaDescontoPct(familiaId: string, pct: number | null): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ desconto_pct: pct }).eq('id', familiaId);
  if (error) throw error;
}

export async function toggleDescontoLote(loteId: string, exibir: boolean): Promise<void> {
  const { error } = await supabase.from('familias')
    .update({ exibir_com_desconto: exibir }).eq('lote_id', loteId);
  if (error) throw error;
}

export async function updateFamiliaAtacado(familiaId: string, faixas: FaixaAtacado[]): Promise<void> {
  const atacado = faixas.length > 0 ? (faixas as unknown as Database['public']['Tables']['familias']['Update']['atacado']) : null;
  const { error } = await supabase.from('familias')
    .update({ atacado, atacado_status: null, atacado_erro: null })
    .eq('id', familiaId);
  if (error) throw error;
}

export async function setAtacadoLote(loteId: string, faixas: FaixaAtacado[]): Promise<void> {
  const atacado = faixas.length > 0 ? (faixas as unknown as Database['public']['Tables']['familias']['Update']['atacado']) : null;
  const { error } = await supabase.from('familias')
    .update({ atacado, atacado_status: null, atacado_erro: null })
    .eq('lote_id', loteId);
  if (error) throw error;
}

// ADR-0078 F2: config POR FAIXA de preço — grava em TODAS as variações do grupo (a config
// viaja na variação; repreçar nunca a órfã). Desativar desconto = false explícito; desativar
// atacado = [] explícito (null significaria "herda a família" e pode virar LOUD no publish).
export async function setDescontoGrupo(
  variacaoIds: string[], exibir: boolean, pct: number | null,
): Promise<void> {
  const { error } = await supabase.from('variacoes')
    .update({ exibir_com_desconto: exibir, desconto_pct: pct })
    .in('id', variacaoIds);
  if (error) throw error;
}

export async function setAtacadoGrupo(variacaoIds: string[], faixas: FaixaAtacado[]): Promise<void> {
  const { error } = await supabase.from('variacoes')
    .update({ atacado: faixas as unknown as Database['public']['Tables']['variacoes']['Update']['atacado'] })
    .in('id', variacaoIds);
  if (error) throw error;
}

// ============================================================================
// Publicados
// ============================================================================

type VariacaoPub = Pick<VariacaoRow, 'codigo' | 'gtin' | 'preco_publicacao' | 'excluida_da_publicacao'>;

export function publicadoFromRow(r: FamiliaRow & { variacoes: VariacaoPub[] }): PublicadoItem {
  const incl = (r.variacoes ?? []).filter((v) => !v.excluida_da_publicacao);
  const base = incl.length > 0 ? incl : (r.variacoes ?? []);
  const precos = base
    .map((v) => Number(v.preco_publicacao))
    .filter((n) => !Number.isNaN(n) && n > 0);
  // EAN representativo do anúncio: a variação principal; senão a 1ª publicável com GTIN.
  const principal = base.find((v) => v.codigo === r.variacao_principal_codigo);
  const gtin = principal?.gtin ?? base.find((v) => v.gtin)?.gtin ?? null;
  // Códigos e GTINs de cada variação, para a busca achar o anúncio por qualquer um deles.
  const identificadores = base
    .flatMap((v) => [v.codigo, v.gtin])
    .filter((s): s is string => !!s);
  return {
    familiaId: r.id,
    codigoPai: r.codigo_pai,
    gtin,
    identificadores,
    titulo: r.titulo_ml ?? r.nome_pai ?? '(sem título)',
    fornecedor: r.fornecedor ?? null,
    tipo: r.tipo_aviamento ?? null,
    categoria: r.categoria_nome ?? null,
    precoPublicacao: precos.length ? Math.min(...precos) : 0,
    descricao: r.descricao_ml ?? null,
    mlItemId: r.ml_item_id!,
    mlPermalink: r.ml_permalink ?? null,
    publicadoEm: r.publicado_em ?? null,
  };
}

export async function fetchPublicados(): Promise<PublicadoItem[]> {
  const { data, error } = await supabase
    .from('familias')
    .select('id, codigo_pai, variacao_principal_codigo, titulo_ml, nome_pai, fornecedor, tipo_aviamento, categoria_nome, descricao_ml, ml_item_id, ml_permalink, publicado_em, variacoes(codigo, gtin, preco_publicacao, excluida_da_publicacao)')
    .not('ml_item_id', 'is', null)
    .order('publicado_em', { ascending: false });
  if (error) throw error;
  // 1 linha por anúncio (ml_item_id) — várias famílias compartilham o mesmo após ciclos de UPDATE.
  const principais = dedupePublicados(
    (data ?? []).map((r) => publicadoFromRow(r as FamiliaRow & { variacoes: VariacaoPub[] })),
  );

  // Split (ADR-0048): anúncios de partições >0 vivem só em anuncios_externos (familias.ml_item_id
  // guarda só a partição 0). Adiciona-os como itens próprios, herdando os metadados do produto
  // (fornecedor/tipo/categoria/preço/gtin) da família representativa do mesmo codigo_pai. Status e
  // vendas são juntados por mlItemId no hook, então cada anúncio carrega os seus.
  const { data: anuncios } = await supabase
    .from('anuncios_externos')
    .select('codigo_pai, item_externo_id, permalink, titulo, publicado_em, variacoes_externas')
    .eq('canal', 'mercado_livre')
    .not('item_externo_id', 'is', null);

  // Fonte de verdade da qtd. de variações publicadas por anúncio: `variacoes_externas`
  // (mantido por dual-write dos workers). A família representativa é só a do 1º ciclo de
  // publicação — se o produto ganhou variações em ciclos de UPDATE depois, a contagem pelas
  // suas `variacoes` própria subconta o anúncio.
  const qtdPorAnuncio = new Map(
    (anuncios ?? [])
      .filter((a): a is typeof a & { item_externo_id: string } => !!a.item_externo_id)
      .map((a) => [a.item_externo_id, Object.keys((a.variacoes_externas as Record<string, unknown>) ?? {}).length]),
  );
  const comContagem = principais.map((p) => ({ ...p, qtdVariacoes: qtdPorAnuncio.get(p.mlItemId) ?? 0 }));

  const jaListados = new Set(principais.map((p) => p.mlItemId));
  const repPorCodigo = new Map(principais.map((p) => [p.codigoPai, p]));
  const extras: PublicadoItem[] = [];
  for (const a of anuncios ?? []) {
    if (!a.item_externo_id || jaListados.has(a.item_externo_id)) continue;
    const rep = repPorCodigo.get(a.codigo_pai);
    if (!rep) continue; // sem família representativa carregada — ignora
    extras.push({
      ...rep,
      titulo: a.titulo ?? rep.titulo,
      mlItemId: a.item_externo_id,
      mlPermalink: a.permalink ?? null,
      publicadoEm: a.publicado_em ?? rep.publicadoEm,
      qtdVariacoes: qtdPorAnuncio.get(a.item_externo_id) ?? 0,
    });
  }
  return [...comContagem, ...extras];
}

export interface StatusPublicadoItem {
  ml_item_id: string;
  /** Canal do anúncio (E6/ADR-0061). Default 'mercado_livre' na leitura para compat com
   *  respostas antigas (o backend sempre envia hoje; guarda defensiva no consumo). */
  canal?: string;
  status: StatusPublicado;
  motivo: string | null;
  estoque: number | null;
  preco: number | null;
  listingType?: 'classico' | 'premium' | null;
}

export interface ResultadoStatusPublicados {
  itens: StatusPublicadoItem[];
  semCredencialML?: boolean;
}

export async function fetchStatusPublicados(): Promise<ResultadoStatusPublicados> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão');
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/status-publicados`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({}),
    }
  );
  const json = await resp.json().catch(() => ({ itens: [] }));
  if (!resp.ok) throw new Error(json?.erro ?? `Falha (${resp.status})`);
  return json as ResultadoStatusPublicados;
}

/** Conexões de canal da org (E7 marketplace_connections, RLS já escopa por org). */
export interface Conexao {
  canal: string;
  contaLabel: string | null;
}

export async function fetchConexoes(): Promise<Conexao[]> {
  const { data, error } = await supabase
    .from('marketplace_connections')
    .select('canal, conta_label');
  if (error) throw error;
  return (data ?? []).map((r) => ({ canal: r.canal, contaLabel: r.conta_label }));
}
