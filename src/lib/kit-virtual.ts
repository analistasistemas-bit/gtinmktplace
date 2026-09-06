// ADR-0154 (Kit Virtual): wrappers do front para as três edges do diálogo de criação
// (buscar-componentes-kit-virtual, preview-kit-virtual, criar-kit-virtual) + as conversões
// puras que a UI precisa. Mesmo padrão de `lib/kit.ts` (ADR-0151): tipos camelCase no front,
// snake_case só na borda com `supabase.functions.invoke`.
import { supabase } from './supabase';
import { erroDaEdge, corpoDoErroDaEdge } from './edge-erro';

// ─── Desconto: 0-1 no ML, 0-100 na tela (D-3 da migration — nunca confundir com as demais
// colunas `desconto_pct` do projeto, que já são 0-100) ───────────────────────────────────────

/** Teto exclusivo — o ML e a migration rejeitam `desconto_pct >= 1` (100%). */
export const DESCONTO_KIT_VIRTUAL_MAX_PCT = 99;

/** Percentual (0-99, o que o operador digita) → fração 0-1 (o que a API espera). */
export function pctParaFracaoDesconto(pct: number): number {
  return Math.round(pct) / 100;
}

/** Fração 0-1 (o que a API devolve) → percentual 0-99 (o que a tela mostra). */
export function fracaoParaPctDesconto(fracao: number): number {
  return Math.round(fracao * 100);
}

// ─── buscar-componentes-kit-virtual ────────────────────────────────────────────────────────

export interface ComponenteCandidatoKitVirtual {
  userProductId: string;
  /** null quando o candidato não casa com nenhum item publicado localmente. */
  itemId: string | null;
  title: string;
  type: 'available' | 'non_available';
  thumbnailUrl: string | null;
  categoryName: string | null;
  estoque: number | null;
  reasons: { id: string; message: string }[];
  codigo: string | null;
  codigoPai: string | null;
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  /** ADR-0154 D-9: não-null quando o próprio candidato é um kit vinculado (ADR-0151). */
  kitMultiplicador: number | null;
  /** Preço de venda ATUAL no ML, lido pela própria edge (service_role, org-scoped) — null quando
   *  o candidato não casou com item local. Pré-preenche o campo editável da composição. */
  precoAtualML: number | null;
  /** `category_id` do ML, idem. `preview-kit-virtual` exige isto do PRINCIPAL (ordem 0) — sem
   *  ele, o produto não pode liderar a composição (ver DialogCriarKitVirtual). */
  categoriaMlId: string | null;
}

export interface ResultadoBuscarComponentesKitVirtual {
  elegiveis: ComponenteCandidatoKitVirtual[];
  inelegiveis: ComponenteCandidatoKitVirtual[];
}

interface ComponenteWire {
  user_product_id: string;
  item_id: string | null;
  title: string;
  type: 'available' | 'non_available';
  thumbnail_url: string | null;
  category_name: string | null;
  estoque: number | null;
  reasons: { id: string; message: string }[];
  codigo: string | null;
  codigo_pai: string | null;
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  kit_multiplicador: number | null;
  preco_atual_ml: number | null;
  categoria_ml_id: string | null;
}

function componenteFromWire(c: ComponenteWire): ComponenteCandidatoKitVirtual {
  return {
    userProductId: c.user_product_id,
    itemId: c.item_id,
    title: c.title,
    type: c.type,
    thumbnailUrl: c.thumbnail_url,
    categoryName: c.category_name,
    estoque: c.estoque,
    reasons: c.reasons ?? [],
    codigo: c.codigo,
    codigoPai: c.codigo_pai,
    custo: c.custo,
    origem: c.origem,
    kitMultiplicador: c.kit_multiplicador,
    precoAtualML: c.preco_atual_ml,
    categoriaMlId: c.categoria_ml_id,
  };
}

export async function buscarComponentesKitVirtual(searchText?: string): Promise<ResultadoBuscarComponentesKitVirtual> {
  const { data, error } = await supabase.functions.invoke('buscar-componentes-kit-virtual', {
    body: searchText ? { search_text: searchText } : {},
  });
  if (error) throw await erroDaEdge(error);
  const d = data as { elegiveis: ComponenteWire[]; inelegiveis: ComponenteWire[] };
  return {
    elegiveis: (d.elegiveis ?? []).map(componenteFromWire),
    inelegiveis: (d.inelegiveis ?? []).map(componenteFromWire),
  };
}

// ─── preview-kit-virtual ────────────────────────────────────────────────────────────────────

export interface ComponenteParaPreviewKit {
  ordem: number;
  userProductId: string;
  quantidade: number;
  precoAtualML: number;
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  titulo: string;
  kitMultiplicador: number | null;
}

export interface RateioComponenteKitVirtual {
  ordem: number;
  unitAmount: number;
  totalAmount: number;
  imposto: number;
}

export type CampoFaltanteMargemKit = 'custo' | 'origem' | 'aliquotas' | 'comissao';

/** Espelha `_shared/kit-virtual/margem.ts:ResultadoMargemKit` — Decisão 6: nunca 0/— disfarçado. */
export type ResultadoMargemKitVirtual =
  | {
    ok: true;
    precoKit: number;
    rateio: RateioComponenteKitVirtual[];
    custoTotal: number;
    impostoTotal: number;
    liquido: number;
    margemPct: number;
  }
  | { ok: false; faltando: { ordem: number; campo: CampoFaltanteMargemKit }[] };

export interface PreviewKitVirtualResultado {
  titulo: string;
  descontoPct: number;
  descricao: string | null;
  descricaoGeradaPorIA: boolean;
  avisoKitVinculado: boolean;
  margemEstimativa: true;
  margem: ResultadoMargemKitVirtual;
}

export async function previewKitVirtual(input: {
  componentes: ComponenteParaPreviewKit[];
  descontoPct: number;
  categoriaMlIdPrincipal: string;
  gerarDescricao: boolean;
  frete?: number;
}): Promise<PreviewKitVirtualResultado> {
  const { data, error } = await supabase.functions.invoke('preview-kit-virtual', {
    body: {
      componentes: input.componentes.map((c) => ({
        ordem: c.ordem,
        user_product_id: c.userProductId,
        quantidade: c.quantidade,
        preco_atual_ml: c.precoAtualML,
        custo: c.custo,
        origem: c.origem,
        titulo: c.titulo,
        kit_multiplicador: c.kitMultiplicador,
      })),
      desconto_pct: input.descontoPct,
      categoria_ml_id: input.categoriaMlIdPrincipal,
      gerar_descricao: input.gerarDescricao,
      ...(input.frete != null ? { frete: input.frete } : {}),
    },
  });
  if (error) throw await erroDaEdge(error);
  const d = data as {
    titulo: string; desconto_pct: number; descricao: string | null; descricao_gerada_por_ia: boolean;
    aviso_kit_vinculado: boolean; margem_estimativa: true; margem: ResultadoMargemKitVirtual;
  };
  return {
    titulo: d.titulo,
    descontoPct: d.desconto_pct,
    descricao: d.descricao,
    descricaoGeradaPorIA: d.descricao_gerada_por_ia,
    avisoKitVinculado: d.aviso_kit_vinculado,
    margemEstimativa: d.margem_estimativa,
    margem: d.margem,
  };
}

// ─── criar-kit-virtual ──────────────────────────────────────────────────────────────────────

export interface ComponenteParaCriarKitVirtual {
  userProductId: string;
  quantidade: number;
  /** Fração 0-1, IDÊNTICA em todos os componentes (o ML exige). */
  descontoPct: number;
  itemExternoId: string | null;
  codigo: string | null;
  codigoPai: string | null;
}

export type ResultadoCriarKitVirtual =
  | {
    ok: true;
    kitId: string;
    mlItemId: string;
    mlUserProductId: string | null;
    mlPermalink: string | null;
    jaExistia: boolean;
  }
  | { ok: false; motivo?: string; mensagem?: string; kitId?: string };

/** Mensagens humanizadas para os motivos de recusa que a edge devolve SEM `mensagem` (recusa de
 *  validação, antes de qualquer rede) — os demais motivos já chegam com `mensagem` pronta da
 *  edge (falha_leitura/falha_criar_kit/falha_componentes/falha_foto/ml_recusou/falha_publicar). */
const MENSAGEM_MOTIVO_CRIAR_KIT_VIRTUAL: Record<string, string> = {
  chave_invalida: 'Chave de cadastro inválida — feche e reabra o diálogo.',
  titulo_invalido: 'Informe um título para o kit.',
  componentes_invalidos: 'Selecione entre 2 e 6 componentes válidos.',
  componente_duplicado: 'O mesmo produto não pode entrar duas vezes no kit.',
  quantidade_invalida: 'Quantidade de cada componente precisa ser entre 1 e 10.',
  desconto_invalido: 'Desconto inválido.',
  desconto_divergente: 'O desconto precisa ser igual para todos os componentes.',
  foto_obrigatoria: 'O kit precisa de uma foto própria antes de publicar.',
};

export async function criarKitVirtualEdge(input: {
  chaveCadastro: string;
  titulo: string;
  descricao: string | null;
  fotoStoragePath: string | null;
  fotoMlPictureId: string | null;
  /** Clássico/Premium. Omitido = a edge default para 'gold_pro' (criar-kit-virtual/index.ts).
   *  Só chega preenchido no fluxo de Refazer (ADR-0154 D-8/migration Task 7-8), que reusa o
   *  `listing_type_id` do kit antigo — o diálogo não tem um seletor para escolher isto do zero. */
  listingTypeId?: string;
  componentes: ComponenteParaCriarKitVirtual[];
}): Promise<ResultadoCriarKitVirtual> {
  const { data, error } = await supabase.functions.invoke('criar-kit-virtual', {
    body: {
      chave_cadastro: input.chaveCadastro,
      titulo: input.titulo,
      descricao: input.descricao,
      foto_storage_path: input.fotoStoragePath,
      foto_ml_picture_id: input.fotoMlPictureId,
      listing_type_id: input.listingTypeId,
      componentes: input.componentes.map((c) => ({
        user_product_id: c.userProductId,
        quantidade: c.quantidade,
        desconto_pct: c.descontoPct,
        item_externo_id: c.itemExternoId,
        codigo: c.codigo,
        codigo_pai: c.codigoPai,
      })),
    },
  });
  if (error) {
    // supabase.functions.invoke NÃO popula `data` em resposta não-2xx (mesma ressalva de
    // lib/kit.ts:criarKitVinculado).
    const detalhe = await corpoDoErroDaEdge(error);
    if (detalhe) {
      const motivo = typeof detalhe.corpo.motivo === 'string' ? detalhe.corpo.motivo : undefined;
      const mensagemEdge = typeof detalhe.corpo.error === 'string' ? detalhe.corpo.error : undefined;
      // `error` no corpo é `mensagem ?? motivo` (ver criar-kit-virtual/index.ts) — quando a
      // edge não tinha mensagem humanizada pra este motivo, `error` é o próprio motivo cru
      // (ex.: "foto_obrigatoria"); o mapa acima cobre exatamente esses casos.
      const mensagem = (motivo && MENSAGEM_MOTIVO_CRIAR_KIT_VIRTUAL[motivo]) ?? mensagemEdge ?? error.message;
      return { ok: false, motivo, mensagem, kitId: typeof detalhe.corpo.kit_id === 'string' ? detalhe.corpo.kit_id : undefined };
    }
    return { ok: false, mensagem: error.message };
  }
  const d = data as {
    kit_id: string; ml_item_id: string; ml_user_product_id: string | null;
    ml_permalink: string | null; ja_existia: boolean;
  };
  return {
    ok: true,
    kitId: d.kit_id,
    mlItemId: d.ml_item_id,
    mlUserProductId: d.ml_user_product_id,
    mlPermalink: d.ml_permalink,
    jaExistia: d.ja_existia,
  };
}

// ─── subir-foto-kit-virtual (ADR-0154 D-5/ADR-0033) ────────────────────────────────────────────
// Sobe a foto ao ML no momento do upload no diálogo, não no clique de publicar — a propagação é
// assíncrona e um picture_id recém-criado costuma ser recusado por minutos. `criar-kit-virtual`
// mantém o upload como fallback (rede de segurança) quando esta chamada falha ou não roda.

export type ResultadoSubirFotoKitVirtual =
  | { ok: true; pictureId: string }
  | { ok: false; mensagem: string };

export async function subirFotoKitVirtualEdge(fotoStoragePath: string): Promise<ResultadoSubirFotoKitVirtual> {
  const { data, error } = await supabase.functions.invoke('subir-foto-kit-virtual', {
    body: { foto_storage_path: fotoStoragePath },
  });
  if (error) {
    const detalhe = await corpoDoErroDaEdge(error);
    const mensagem = (detalhe && typeof detalhe.corpo.error === 'string' ? detalhe.corpo.error : undefined) ?? error.message;
    return { ok: false, mensagem };
  }
  const d = data as { picture_id: string };
  return { ok: true, pictureId: d.picture_id };
}

// ─── encerrar-kit-virtual (ADR-0154 D-8) ───────────────────────────────────────────────────────
// "Refazer kit": a composição é imutável no ML, então trocar um componente é encerrar o kit
// atual e reabrir o diálogo para criar outro (Publicados.tsx).

export type ResultadoEncerrarKitVirtual =
  | { ok: true; kitId: string; jaEncerrado: boolean }
  | { ok: false; motivo?: string; mensagem?: string };

export async function encerrarKitVirtualEdge(kitId: string): Promise<ResultadoEncerrarKitVirtual> {
  const { data, error } = await supabase.functions.invoke('encerrar-kit-virtual', {
    body: { kit_id: kitId },
  });
  if (error) {
    const detalhe = await corpoDoErroDaEdge(error);
    const motivo = detalhe && typeof detalhe.corpo.motivo === 'string' ? detalhe.corpo.motivo : undefined;
    const mensagem = (detalhe && typeof detalhe.corpo.error === 'string' ? detalhe.corpo.error : undefined) ?? error.message;
    return { ok: false, motivo, mensagem };
  }
  const d = data as { kit_id: string; ja_encerrado: boolean };
  return { ok: true, kitId: d.kit_id, jaEncerrado: d.ja_encerrado };
}

// ─── Composição em edição no diálogo (estado compartilhado entre a lista e o preview) ────────

export interface ComponenteSelecionadoKitVirtual {
  candidato: ComponenteCandidatoKitVirtual;
  quantidade: number;
  /** Preço de venda ATUAL no ML (R$) — `buscar-componentes-kit-virtual` não devolve preço (só
   *  custo/origem/categoria), então o operador confirma/edita aqui. Alimenta o rateio e a
   *  margem do preview; nunca é enviado ao ML (o kit publica com `automatic_price`, D-3). */
  precoAtualML: number;
}

const LABEL_CAMPO_FALTANTE: Record<CampoFaltanteMargemKit, string> = {
  custo: 'custo',
  origem: 'origem fiscal',
  aliquotas: 'alíquota confirmada da organização',
  comissao: 'comissão do Mercado Livre',
};

/** Mensagem "margem indisponível: falta custo em X" (Decisão 6) — nunca 0%/— disfarçado. */
export function descreverFaltandoMargemKit(
  faltando: { ordem: number; campo: CampoFaltanteMargemKit }[],
  componentes: ComponenteSelecionadoKitVirtual[],
): string {
  const partes = faltando.map(({ ordem, campo }) => {
    const nome = ordem >= 0 ? (componentes[ordem]?.candidato.title ?? `componente ${ordem + 1}`) : 'organização';
    return `${LABEL_CAMPO_FALTANTE[campo]} em ${nome}`;
  });
  return `margem indisponível: falta ${partes.join(', ')}`;
}

// ─── Refazer kit: carrega o kit encerrado para pré-preencher o diálogo (ADR-0154 D-8) ────────
// "Refazer kit" (Publicados.tsx) encerra o kit no ML e reabre o diálogo já carregado com os
// componentes/título/descrição/desconto/listing type/foto do kit antigo — a alternativa
// rejeitada era reabrir em branco (ver Decisão 8 do ADR e a discussão que a precedeu).

export interface KitVirtualParaRefazer {
  componentes: ComponenteSelecionadoKitVirtual[];
  titulo: string;
  descricao: string | null;
  /** Percentual 0-99 (escala da tela) — já convertido da fração 0-1 armazenada no banco. */
  descontoPct: number;
  listingTypeId: string;
  fotoStoragePath: string | null;
  fotoMlPictureId: string | null;
}

export type ResultadoCarregarKitVirtualParaRefazer =
  | { ok: true; dados: KitVirtualParaRefazer; componentesNaoRecuperados: number }
  | { ok: false; motivo: 'nao_encontrado' | 'sem_componentes_suficientes' | 'falha_leitura'; mensagem?: string };

/**
 * Busca o kit encerrado (`kits_virtuais` + `kits_virtuais_componentes`, select org-scoped por
 * RLS — encerrar só faz `update status`, nunca apaga a linha) e casa cada componente armazenado
 * com o candidato ATUAL do buscador do ML (`buscarComponentesKitVirtual` sem filtro de texto
 * devolve TODO o catálogo de componentes da org, D-12) para recuperar preço, categoria, custo e
 * origem — nenhum desses campos é persistido em `kits_virtuais_componentes` (só
 * user_product_id/quantidade/codigo/codigo_pai sobrevivem).
 *
 * Um componente que não aparece mais no buscador (produto removido/pausado entre a criação do
 * kit velho e o refazer) é descartado do pré-preenchimento — não há como reconstruir
 * título/categoria/preço dele sem essa chamada — e contado em `componentesNaoRecuperados`, para
 * o chamador avisar o operador em vez de entregar uma composição incompleta em silêncio.
 * `ok:false` (kit sumiu, ou sobrou menos de 2 componentes reconstruíveis) é o sinal para o
 * chamador cair no diálogo em branco — o mesmo comportamento de antes desta função existir.
 */
export async function carregarKitVirtualParaRefazer(kitId: string): Promise<ResultadoCarregarKitVirtualParaRefazer> {
  const [kitResp, componentesResp] = await Promise.all([
    supabase.from('kits_virtuais')
      .select('titulo, descricao, desconto_pct, listing_type_id, foto_storage_path, foto_ml_picture_id')
      .eq('id', kitId).maybeSingle(),
    supabase.from('kits_virtuais_componentes')
      .select('user_product_id, quantidade')
      .eq('kit_id', kitId).order('ordem', { ascending: true }),
  ]);
  if (kitResp.error) return { ok: false, motivo: 'falha_leitura', mensagem: kitResp.error.message };
  if (componentesResp.error) return { ok: false, motivo: 'falha_leitura', mensagem: componentesResp.error.message };
  if (!kitResp.data) return { ok: false, motivo: 'nao_encontrado' };

  const componentesArmazenados = (componentesResp.data ?? []) as { user_product_id: string; quantidade: number }[];
  if (componentesArmazenados.length === 0) return { ok: false, motivo: 'sem_componentes_suficientes' };

  const { elegiveis, inelegiveis } = await buscarComponentesKitVirtual();
  const candidatoPorUserProduct = new Map([...elegiveis, ...inelegiveis].map((c) => [c.userProductId, c]));

  const componentes: ComponenteSelecionadoKitVirtual[] = [];
  let componentesNaoRecuperados = 0;
  for (const c of componentesArmazenados) {
    const candidato = candidatoPorUserProduct.get(c.user_product_id);
    if (!candidato) {
      componentesNaoRecuperados++;
      console.warn('kit_virtual_refazer_componente_nao_encontrado', { kitId, userProductId: c.user_product_id });
      continue;
    }
    // Mesmo fallback de `adicionar()` no diálogo: preço nunca chega null (bloquearia
    // precosValidos sem explicação) — 0 ainda bloqueia, mas de forma editável pelo operador.
    componentes.push({ candidato, quantidade: c.quantidade, precoAtualML: candidato.precoAtualML ?? 0 });
  }
  if (componentes.length < 2) return { ok: false, motivo: 'sem_componentes_suficientes' };

  const kit = kitResp.data as {
    titulo: string; descricao: string | null; desconto_pct: number;
    listing_type_id: string; foto_storage_path: string | null; foto_ml_picture_id: string | null;
  };
  return {
    ok: true,
    componentesNaoRecuperados,
    dados: {
      componentes,
      titulo: kit.titulo,
      descricao: kit.descricao,
      descontoPct: fracaoParaPctDesconto(kit.desconto_pct),
      listingTypeId: kit.listing_type_id,
      fotoStoragePath: kit.foto_storage_path,
      fotoMlPictureId: kit.foto_ml_picture_id,
    },
  };
}

/**
 * Decide o pré-preenchimento do diálogo de Refazer a partir do resultado JÁ RESOLVIDO do
 * encerrar-kit-virtual (ADR-0154, regra "cuide da ordem": o kit velho precisa estar encerrado
 * antes do novo ser publicado, senão o ML pode recusar por composição duplicada). Recebe o
 * resultado pronto em vez de chamar `encerrarKitVirtualEdge` de novo — quem encerra é a mutation
 * de `useEncerrarKitVirtual` (ela já invalida as queries de Publicados no sucesso); esta função
 * só decide o que vem DEPOIS, e nunca chama `carregarParaRefazer` quando `resultadoEncerrar` não
 * é sucesso — sem isso, o operador reabriria o diálogo pré-preenchido com um kit que ainda está
 * no ar no ML.
 */
export async function prefillAposEncerrarKitVirtual(
  kitId: string,
  resultadoEncerrar: ResultadoEncerrarKitVirtual,
  carregarParaRefazer: (kitId: string) => Promise<ResultadoCarregarKitVirtualParaRefazer>,
): Promise<{ dadosParaPrefill: KitVirtualParaRefazer | null; componentesNaoRecuperados: number; mensagemCarregarFalhou?: string } | null> {
  if (!resultadoEncerrar.ok) return null;
  const carregado = await carregarParaRefazer(kitId);
  if (!carregado.ok) {
    return { dadosParaPrefill: null, componentesNaoRecuperados: 0, mensagemCarregarFalhou: carregado.mensagem ?? carregado.motivo };
  }
  return { dadosParaPrefill: carregado.dados, componentesNaoRecuperados: carregado.componentesNaoRecuperados };
}
