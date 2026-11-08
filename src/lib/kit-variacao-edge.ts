// ADR-0197 (Task 13): chamadas da tela às edges do kit com variação e leituras (RLS por org). Corpo das edges em
// snake_case; `functions.invoke` não popula `data` em não-2xx, o motivo vem de `corpoDoErroDaEdge`.
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import type { CriarKitVariacaoInput } from '@/lib/kit-variacao';

export type Resultado<T> = ({ ok: true } & T) | { ok: false; motivo?: string; mensagem: string };

async function invocar<T>(nome: string, body: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await supabase.functions.invoke(nome, { body });
  if (error) {
    const d = await corpoDoErroDaEdge(error);
    return {
      ok: false,
      motivo: typeof d?.corpo.motivo === 'string' ? d.corpo.motivo : d ? undefined : 'rede',
      mensagem: typeof d?.corpo.error === 'string' ? d.corpo.error : error.message,
    };
  }
  return { ok: true, ...(data as T) };
}

export function criarKitVariacaoEdge(i: CriarKitVariacaoInput) {
  return invocar<{ kit_id?: string; aviso?: string }>('criar-kit-variacao', {
    familia_base_id: i.familiaBaseId, cores: i.cores, pecas_por_kit: i.pecasPorKit, preco: i.preco,
    quantidades: i.quantidades, titulo: i.titulo, descricao: i.descricao, fotos: i.fotos,
    so_em_kit: i.soEmKit, meta: i.meta, chave_cadastro: i.chaveCadastro,
    ...(i.previaId ? { previa_id: i.previaId } : {}),
    ...(i.listingTypeId ? { listing_type_id: i.listingTypeId } : {}),
  });
}

export function gerarTextoKitEdge(p: { familiaBaseId: string; pecasPorKit: number; cores: string[] }) {
  return invocar<{ titulo: string; descricao: string; previa_id?: string }>('gerar-texto-kit', {
    familia_base_id: p.familiaBaseId, pecas_por_kit: p.pecasPorKit, cores: p.cores,
  });
}

export type AcaoKit =
  | 'ligar_so_em_kit' | 'desligar_so_em_kit' | 'ligar_reposicao' | 'desligar_reposicao' | 'alterar_meta'
  | 'montar' | 'desmontar';

export function gerenciarKitEdge(p: {
  kitId: string; acao: AcaoKit; versao?: number; meta?: number; itens?: Array<{ codigo: string; quantidade: number }>;
}) {
  return invocar<{ transferencia_id?: string; transferenciaId?: string; reposicaoDesligada?: boolean; soEmKit?: boolean }>(
    'gerenciar-kit-variacao',
    { kit_id: p.kitId, acao: p.acao, versao: p.versao, meta: p.meta, itens: p.itens },
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Leituras

export interface KitVariacaoResumo {
  id: string;
  codigoPaiBase: string;
  codigoPaiKit: string;
  pecasPorKit: number;
  soEmKit: boolean;
  reposicaoAuto: boolean;
  meta: number;
  versao: number;
  /** `publicando` (saga montando), `publicado`, `erro` (saga travou: combinações podem faltar). */
  status: string;
}

export async function fetchKitsVariacao(): Promise<KitVariacaoResumo[]> {
  const { data, error } = await supabase.from('kits_variacao')
    .select('id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, so_em_kit, reposicao_auto, meta, versao, status')
    .order('criado_em', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((k) => ({
    id: k.id, codigoPaiBase: k.codigo_pai_base, codigoPaiKit: k.codigo_pai_kit, pecasPorKit: k.pecas_por_kit,
    soEmKit: k.so_em_kit, reposicaoAuto: k.reposicao_auto, meta: k.meta, versao: k.versao, status: k.status,
  }));
}

export interface SkuKitSaldo { codigo: string; tamanho: string; rotulo: string; cores: string[]; saldo: number | null }
export interface TransferenciaAberta { id: string; tipo: string; estado: string; passo: string; alerta: string | null; criadoEm: string }

export async function fetchDetalheKitVariacao(kitId: string): Promise<{ skus: SkuKitSaldo[]; abertas: TransferenciaAberta[] }> {
  const [skusR, transR] = await Promise.all([
    supabase.from('kit_variacao_skus').select('codigo, tamanho, rotulo_cor, cores').eq('kit_id', kitId),
    supabase.from('kit_transferencias').select('id, tipo, estado, passo, alerta, criado_em')
      .eq('kit_id', kitId).in('estado', ['ativa', 'travada']).order('criado_em', { ascending: true }),
  ]);
  if (skusR.error) throw skusR.error;
  if (transR.error) throw transR.error;
  const codigos = (skusR.data ?? []).map((s) => s.codigo);
  // Saldo = variação canônica (família mais recente do código), a mesma âncora da saga.
  const saldo = new Map<string, { estoque: number; em: string }>();
  if (codigos.length > 0) {
    const { data, error } = await supabase.from('variacoes').select('codigo, estoque, familias(criado_em)').in('codigo', codigos);
    if (error) throw error;
    for (const v of data ?? []) {
      const f = (v as { familias?: { criado_em?: string } | Array<{ criado_em?: string }> }).familias;
      const em = (Array.isArray(f) ? f[0]?.criado_em : f?.criado_em) ?? '';
      const atual = saldo.get(v.codigo);
      if (!atual || em > atual.em) saldo.set(v.codigo, { estoque: v.estoque, em });
    }
  }
  return {
    skus: (skusR.data ?? []).map((s) => ({
      codigo: s.codigo, tamanho: s.tamanho, rotulo: s.rotulo_cor, cores: s.cores, saldo: saldo.get(s.codigo)?.estoque ?? null,
    })).sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.tamanho.localeCompare(b.tamanho)),
    abertas: (transR.data ?? []).map((t) => ({
      id: t.id, tipo: t.tipo, estado: t.estado, passo: t.passo, alerta: t.alerta, criadoEm: t.criado_em,
    })),
  };
}
