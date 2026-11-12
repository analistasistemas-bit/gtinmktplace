// ADR-0200 (Task 13): chamadas da tela às edges do kit com variação e leituras (RLS por org). Corpo das edges em
// snake_case; `functions.invoke` não popula `data` em não-2xx, o motivo vem de `corpoDoErroDaEdge`.
import { supabase } from '@/lib/supabase';
import { corpoDoErroDaEdge } from '@/lib/edge-erro';
import type { CriarKitVariacaoInput } from '@/lib/kit-variacao';
import { effectiveOrgId, useSupportStore } from '@/stores/support-store';
import { storageOwnerForUpload } from '@/hooks/useUploadLote';
import { buildStoragePath, uploadFile } from '@/lib/storage';
import { quarentenaAte } from '@/lib/kit-transferencia-etapa';
import type { PrecoPeca, PromocaoFutura } from '@/lib/kit-preco-avulso';

/** Preço avulso das peças da base, lido do ML na hora (edge `preco-avulso-kit`, só leitura). Lança em falha:
 *  a tela mostra "preço avulso indisponível" sem bloquear. */
export async function fetchPrecoAvulsoKit(familiaBaseId: string): Promise<Map<string, PrecoPeca>> {
  const { data, error } = await supabase.functions.invoke('preco-avulso-kit', { body: { familia_base_id: familiaBaseId } });
  if (error) throw error;
  type Bruto = Record<string, {
    normal: number | null; promocao: number | null; fim_promocao: string | null;
    futuras?: PromocaoFutura[]; futuras_indisponivel?: boolean;
  }>;
  const pecas = (data as { pecas?: Bruto } | null)?.pecas ?? {};
  return new Map(Object.entries(pecas).map(([sku, p]) => [sku, {
    normal: p.normal, promocao: p.promocao, fimPromocao: p.fim_promocao,
    futuras: p.futuras ?? [], futurasIndisponivel: p.futuras_indisponivel === true,
  }]));
}

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

/** Montar mais (Task 13, ajuste): o que já é SKU do kit só aumenta; combinação × tamanho novo vira SKU no mesmo kit. */
export function adicionarAoKitEdge(p: {
  kitId: string; versao: number; quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  fotos: Record<string, string>; chaveCadastro: string;
}) {
  return invocar<{ transferenciaId?: string; aviso?: string; versao?: number }>('criar-kit-variacao', {
    kit_id: p.kitId, versao: p.versao, quantidades: p.quantidades, fotos: p.fotos, chave_cadastro: p.chaveCadastro,
  });
}

/** Foto de combinação no bucket `imagens`, sob a pasta do dono (org ou usuário legado, que a edge exige). */
export async function enviarFotoKit(pasta: string, rotulo: string, file: File): Promise<string> {
  const { data: ud } = await supabase.auth.getUser();
  const orgId = effectiveOrgId();
  if (!ud.user?.id || !orgId) throw new Error('Sem sessão');
  const dono = storageOwnerForUpload(ud.user.id, orgId, useSupportStore.getState().context?.scope ?? null);
  return uploadFile('imagens', buildStoragePath(dono, pasta, `${rotulo}-${file.name}`), file);
}

/** `tamanhos`: os do kit (com quantidade > 0); sem eles, o guia do texto lista todos os da base. */
export function gerarTextoKitEdge(p: { familiaBaseId: string; pecasPorKit: number; cores: string[]; tamanhos?: string[] }) {
  return invocar<{ titulo: string; descricao: string; previa_id?: string }>('gerar-texto-kit', {
    familia_base_id: p.familiaBaseId, pecas_por_kit: p.pecasPorKit, cores: p.cores,
    ...(p.tamanhos ? { tamanhos: p.tamanhos } : {}),
  });
}

/** Foto da combinação por IA (Task 15). Mesmo `requestId` repete sem gerar de novo; a foto só vale aprovada na tela. */
export function gerarFotoKitEdge(p: { requestId: string; familiaBaseId: string; cores: string[] }) {
  return invocar<RespostaFotoKit>('gerar-foto-kit', {
    request_id: p.requestId, familia_base_id: p.familiaBaseId, cores: p.cores,
  });
}

export type AcaoKit =
  | 'ligar_so_em_kit' | 'desligar_so_em_kit' | 'ligar_reposicao' | 'desligar_reposicao' | 'alterar_meta'
  | 'montar' | 'desmontar' | 'encerrar';

export function gerenciarKitEdge(p: {
  kitId: string; acao: AcaoKit; versao: number; meta?: number; itens?: Array<{ codigo: string; quantidade: number }>;
  /** Montar/desmontar: chave estável da operação (a repetição devolve a transferência original). */
  chave?: string;
  /** Desmontar: desliga também "Vender só em kit", na mesma transação. */
  desligarSoEmKit?: boolean;
}) {
  return invocar<{
    transferenciaId?: string; reposicaoDesligada?: boolean; soEmKit?: boolean; existente?: boolean; versao?: number;
    /** Encerrar sem nada no ML: encerrado na hora, sem transferência. */
    encerrado?: boolean;
  }>(
    'gerenciar-kit-variacao',
    {
      kit_id: p.kitId, acao: p.acao, versao: p.versao, meta: p.meta, itens: p.itens, chave: p.chave,
      desligar_so_em_kit: p.desligarSoEmKit === true,
    },
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
  /** Preço do kit (R$), o mesmo para todas as combinações (combinação nova sai com ele). */
  preco: number;
  /** `publicando` (saga montando), `publicado`, `erro` (saga travou: combinações podem faltar), `encerrando` (fechando
   *  os anúncios no ML) e `encerrado` (fora de Publicados, só leitura). */
  status: string;
  /** Transferência aberta (ativa ou travada) mais recente do kit, para o indicador em Publicados. */
  transferencia?: TransferenciaAberta | null;
  /** Anúncio do kit no ML (família do kit). */
  permalink?: string | null;
  /** Um anúncio por combinação × tamanho (cada um com link próprio no ML), na ordem combinação → tamanho. */
  links?: LinkCombinacaoKit[];
}
export interface LinkCombinacaoKit { rotulo: string; tamanho: string; url: string }

// Alvos embutidos: fim da quarentena (último passo 1) e se é a criação do anúncio do kit.
const SEL_TRANSFERENCIA = 'id, kit_id, tipo, estado, passo, alerta, criado_em, kit_transferencia_alvos(passo1_em, criar)';
type LinhaTransferencia = {
  id: string; kit_id: string | null; tipo: string; estado: string; passo: string; alerta: string | null; criado_em: string;
  kit_transferencia_alvos?: Array<{ passo1_em: string | null; criar: boolean }> | null;
};
function transferenciaDe(t: LinhaTransferencia): TransferenciaAberta {
  const alvos = t.kit_transferencia_alvos ?? [];
  return {
    id: t.id, tipo: t.tipo, estado: t.estado, passo: t.passo, alerta: t.alerta, criadoEm: t.criado_em,
    quarentenaAte: quarentenaAte(alvos.map((a) => a.passo1_em)), criacao: alvos.some((a) => a.criar),
  };
}

export async function fetchKitsVariacao(): Promise<KitVariacaoResumo[]> {
  const [kitsR, transR] = await Promise.all([
    supabase.from('kits_variacao')
      .select('id, codigo_pai_base, codigo_pai_kit, pecas_por_kit, so_em_kit, reposicao_auto, meta, versao, status, preco')
      .order('criado_em', { ascending: true }),
    supabase.from('kit_transferencias').select(SEL_TRANSFERENCIA)
      .in('estado', ['ativa', 'travada']).not('kit_id', 'is', null).order('criado_em', { ascending: true }),
  ]);
  if (kitsR.error) throw kitsR.error;
  if (transR.error) throw transR.error;
  const kits = kitsR.data ?? [];
  const aberta = new Map<string, TransferenciaAberta>();
  for (const t of (transR.data ?? []) as LinhaTransferencia[]) if (t.kit_id) aberta.set(t.kit_id, transferenciaDe(t));
  const permalink = new Map<string, { url: string; em: string }>();
  if (kits.length > 0) {
    const { data, error } = await supabase.from('familias').select('codigo_pai, ml_permalink, criado_em')
      .in('codigo_pai', kits.map((k) => k.codigo_pai_kit)).not('ml_permalink', 'is', null);
    if (error) throw error;
    for (const f of data ?? []) {
      const atual = permalink.get(f.codigo_pai);
      if (!atual || f.criado_em > atual.em) permalink.set(f.codigo_pai, { url: f.ml_permalink as string, em: f.criado_em });
    }
  }
  const links = await fetchLinksKits(kits.map((k) => k.id));
  return kits.map((k) => ({
    links: links.get(k.id) ?? [],
    id: k.id, codigoPaiBase: k.codigo_pai_base, codigoPaiKit: k.codigo_pai_kit, pecasPorKit: k.pecas_por_kit,
    soEmKit: k.so_em_kit, reposicaoAuto: k.reposicao_auto, meta: k.meta, versao: k.versao, status: k.status, preco: Number(k.preco),
    transferencia: aberta.get(k.id) ?? null, permalink: permalink.get(k.codigo_pai_kit)?.url ?? null,
  }));
}

/** Link de cada SKU do kit (combinação × tamanho): o ML publica um item por SKU e só junta no seletor depois de
 *  minutos; `familias.ml_permalink` guarda só o primeiro. Vínculo retirado não conta; vence o mais recente por SKU. */
async function fetchLinksKits(kitIds: string[]): Promise<Map<string, LinkCombinacaoKit[]>> {
  const porKit = new Map<string, LinkCombinacaoKit[]>();
  if (kitIds.length === 0) return porKit;
  const { data: skus, error } = await supabase.from('kit_variacao_skus')
    .select('kit_id, codigo, tamanho, rotulo_cor').in('kit_id', kitIds);
  if (error) throw error;
  if (!skus?.length) return porKit;
  const { data: itens, error: erroItens } = await supabase.from('anuncios_externos_itens')
    .select('sku, permalink, atualizado_em').in('sku', skus.map((s) => s.codigo)).eq('retirado', false).not('permalink', 'is', null);
  if (erroItens) throw erroItens;
  const url = new Map<string, { url: string; em: string }>();
  for (const i of itens ?? []) {
    const atual = url.get(i.sku);
    if (!atual || i.atualizado_em > atual.em) url.set(i.sku, { url: i.permalink as string, em: i.atualizado_em });
  }
  for (const s of skus) {
    const u = url.get(s.codigo)?.url;
    if (!u) continue;
    porKit.set(s.kit_id, [...(porKit.get(s.kit_id) ?? []), { rotulo: s.rotulo_cor, tamanho: s.tamanho, url: u }]);
  }
  for (const l of porKit.values()) l.sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.tamanho.localeCompare(b.tamanho, 'pt-BR', { numeric: true }));
  return porKit;
}

export interface SkuKitSaldo {
  codigo: string; tamanho: string; rotulo: string; cores: string[]; saldo: number | null;
  /** Peças por kit (SKU individual × quantidade), para conferir o saldo da base antes de montar. */
  componentes: Array<{ codigo: string; quantidade: number }>;
}
export interface TransferenciaAberta {
  id: string; tipo: string; estado: string; passo: string; alerta: string | null; criadoEm: string;
  quarentenaAte?: string | null; criacao?: boolean;
}

/** Base canônica do PAI: a família mais recente (criado_em desc, id desc), a mesma âncora das edges do kit. A linha de
 *  Publicados guarda a família MAIS ANTIGA do anúncio (dedupe), que pode não ter as cores incluídas em UPDATE. */
const consultaBaseCanonica = (codigoPai: string) => supabase.from('familias').select('id').eq('codigo_pai', codigoPai)
  .order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(1);

export async function fetchBaseCanonicaId(codigoPai: string): Promise<string> {
  const { data, error } = await consultaBaseCanonica(codigoPai);
  if (error) throw error;
  if (!data?.[0]?.id) throw new Error('Produto não encontrado.');
  return data[0].id;
}

export async function fetchDetalheKitVariacao(kitId: string, codigoPaiBase: string): Promise<{
  skus: SkuKitSaldo[]; abertas: TransferenciaAberta[]; baseFamiliaId: string | null;
}> {
  const [skusR, transR, baseR] = await Promise.all([
    supabase.from('kit_variacao_skus').select('codigo, tamanho, rotulo_cor, cores, kit_variacao_componentes(codigo, quantidade)')
      .eq('kit_id', kitId),
    supabase.from('kit_transferencias').select(SEL_TRANSFERENCIA)
      .eq('kit_id', kitId).in('estado', ['ativa', 'travada']).order('criado_em', { ascending: true }),
    // Base canônica (a mais recente do PAI): cores, tamanhos e saldo das peças para Montar mais.
    consultaBaseCanonica(codigoPaiBase),
  ]);
  if (baseR.error) throw baseR.error;
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
      componentes: ((s as { kit_variacao_componentes?: Array<{ codigo: string; quantidade: number }> }).kit_variacao_componentes ?? []),
    })).sort((a, b) => a.rotulo.localeCompare(b.rotulo) || a.tamanho.localeCompare(b.tamanho)),
    abertas: ((transR.data ?? []) as LinhaTransferencia[]).map(transferenciaDe),
    baseFamiliaId: baseR.data?.[0]?.id ?? null,
  };
}

/** Resposta 200 de `gerar-foto-kit` (ADR-0200, Adendo 1). `path` só vem na aprovada pela verificação. */
export interface ItemVerificado { campo: string; rotulo: string; ok: boolean; nota: string }
export interface RespostaFotoKit {
  path?: string;
  url?: string | null;
  tentativa?: number;
  /** false = reprovada pela verificação; `proxima` diz se a edge tenta de novo com o mesmo request_id. */
  aprovado?: boolean;
  proxima?: boolean;
  verificacao?: { aprovado: boolean; itens: ItemVerificado[]; motivos: string[] } | null;
  motivos?: string[];
  previa_url?: string | null;
  originais?: Array<{ cor: string; urls: string[] }>;
}
