// ADR-0200 (Task 10): cria o kit com variação a partir de uma família publicada em user products.
//
// Tudo que pode falhar sem ser o ML roda aqui, antes de qualquer escrita: depois de `confirmar_reducao` a
// saga já tirou as peças dos individuais, e a única falha aceitável é a do CREATE. Depois grava a família e
// as variações do kit (estoque 0, ainda não participantes) e, numa transação (`kit_variacao_criar`), o kit,
// a composição, a marca d'água inicial e a transferência `montar` com os SKUs de kit como alvo `criar`.
// Nada vai ao ML aqui: a saga pausa as peças, reduz, cria os itens com o saldo e só então credita.
//
// Como `criar-kit-vinculado`: códigos por `proximo_codigo_produto()`, família em lote técnico com
// `status='pronto'`, sem `process-familia`. Diferente dele: não encadeia `publicar-familias`. O único caminho
// de CREATE do SKU de kit é a saga; a publicação comum recusa SKU de kit sob a exclusão da transferência.
import type { AtributoML } from '../_shared/categoria/atributos.ts';
import { aplicarKitNosAtributos } from '../_shared/categoria/atributos.ts';
import type { AtributoSchema } from '../_shared/categoria/schema.ts';
import { gradeDaFamilia } from '../_shared/produto/tipos-produto-valores.ts';
import { parseStatusML } from '../_shared/ml/status.ts';
import { removerCorDoSlot } from '../_shared/cor/sem-atributo.ts';
import { kitLigado } from '../_shared/kit-variacao/politica.ts';
import type { OfertaUP } from '../_shared/kit-variacao/ml-oferta.ts';
import { normalizarCombinacao, rotuloCombinacao } from '../_shared/kit-variacao/combinacoes.ts';
import { pecaDaCor, type FotoPeca } from '../_shared/kit-variacao/galeria-pecas.ts';
import type { PecaOrigem } from '../_shared/kit-variacao/galeria-leitura.ts';
import { STRIP_FAMILIA_KIT, STRIP_VARIACAO_KIT } from '../criar-kit-vinculado/processar.ts';

export interface CriarKitVariacaoInput {
  familiaBaseId: string;
  cores: string[];
  pecasPorKit: number;
  preco: number;
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  titulo: string;
  descricao: string;
  /** Caminho no storage por rótulo da combinação (`rotuloCombinacao`). */
  fotos: Record<string, string>;
  /**
   * ADR-0200 (adendo 12/11): ids das fotos das peças que o operador manteve, por rótulo. Ausente ou vazio = só a foto
   * do kit. O servidor recalcula a proposta; isto só remove (reordenar ou id fora da proposta é descartado).
   */
  galeria?: Record<string, string[]>;
  soEmKit: boolean;
  meta: number;
  chaveCadastro: string;
  /** Clássico (padrão, como em `publicar-familias`) ou Premium: muda a comissão que o simulador cota. */
  listingTypeId?: 'gold_special' | 'gold_pro';
  /** Prévia de `gerar-texto-kit` que produziu título e descrição: o consumo de IA dela passa para o kit. */
  previaId?: string;
}

type Linha = Record<string, unknown>;

export interface BaseKit {
  /** `select('*', EMBED_MODULOS)` da família-base. */
  familia: Linha;
  /** A base é a versão mais recente do PAI (a canônica de custo, peso e saldo). */
  canonica: boolean;
  /** Variações da base incluídas na publicação. */
  variacoes: Linha[];
  /** Vínculo ML dos SKUs da base (`anuncios_externos_itens` da raiz do PAI). */
  vinculos: Array<{ sku: string; item_externo_id: string | null; user_product_id: string | null; catalog_listing_id: string | null }>;
}

export interface ResultadoRpcKit {
  ok: boolean; motivo?: string; codigo?: string; mensagem?: string;
  kit_id?: string; transferencia_id?: string; existente?: boolean;
  /** `kit_variacao_adicionar`: versão do kit depois da operação (também na repetição). */
  versao?: number;
}

/** Cadastro parcial de uma tentativa anterior com a mesma chave (família gravada, kit não). */
export interface CadastroParcial {
  /** `familias.kit_variacao_pedido`: hash do pedido da tentativa que gravou. */
  pedidoHash: string | null;
  familiaId: string;
  loteId: string;
  codigoPai: string;
  variacoes: Array<{ codigo: string; cor: string | null; tamanho: string | null; galeria?: FotoPeca[] }>;
}

export interface DepsCriarKitVariacao {
  /** Org autenticada: dona das fotos (`{org_id}/...`). */
  orgId: string;
  /** Usuários da org: o layout legado do bucket é `{user_id}/...` (policy "imagens: select org"). */
  usuariosDaOrg(): Promise<string[]>;
  lerBase(familiaId: string): Promise<BaseKit | null>;
  /** Família do kit já gravada por uma tentativa anterior com a mesma chave (`familias.chave_cadastro`). */
  parcial(chave: string): Promise<CadastroParcial | null>;
  existente(chave: string): Promise<{ kitId: string; transferenciaId: string | null; pedidoHash: string | null } | null>;
  lerOferta(upId: string, itemIds: string[]): Promise<OfertaUP>;
  /** Caminhos de foto usados por algum item moderado (`under_review`, `forbidden`, `waiting_for_patch`), lido no ML. */
  fotosEmItemModerado(paths: string[]): Promise<string[]>;
  /** ADR-0135 D-7: lança com a mensagem quando o cadastro fiscal da base está incompleto. */
  exigirFiscal(familia: Linha): Promise<void>;
  lerSchema(categoriaId: string): Promise<AtributoSchema[]>;
  /** Resolve (ou cria) a guia de tamanhos da própria conta para a categoria e os tamanhos; lança se não der. */
  garantirGuia(familia: Linha, tamanhos: string[]): Promise<void>;
  reservarCodigos(qtd: number): Promise<{ codigoPai: string; codigos: string[] }>;
  /** Sobe a foto ao ML e devolve o `picture_id`; lança se o caminho não existe ou o ML recusa. */
  subirFoto(path: string): Promise<string>;
  /**
   * ADR-0200 (adendo 12/11): proposta de galeria da combinação (fotos das peças lidas no ML, só leitura; a categoria dá o
   * limite). Ausente = a edge não lê fotos das peças e a galeria é ignorada. Lançar ou `indisponivel` nunca recusa o kit.
   */
  lerGaleria?(pecas: PecaOrigem[], categoriaId: string): Promise<{ fotos: FotoPeca[]; avisos: string[]; indisponivel: boolean }>;
  gravar: {
    lote(): Promise<string>;
    familia(linha: Linha): Promise<string>;
    /**
     * Variações do kit numa RPC sob o lock da família (`kit_variacao_gravar_variacoes`): combinação (cor) + tamanho
     * já gravada por outra requisição da mesma chave reaproveita o código dela. Devolve os códigos finais na ordem de
     * `linhas`. Com `comRetryConcorrencia` (40001 `canonica_trocou`).
     */
    variacoes(familiaId: string, linhas: Linha[]): Promise<string[]>;
    kit(args: { chave: string; kit: Linha; skus: Linha[]; baseline: Array<{ codigo: string; ml: number }>; alvos: Linha[] }): Promise<ResultadoRpcKit>;
    desfazer(loteId: string, familiaId: string | null): Promise<void>;
  };
  enfileirarSaga(transferenciaId: string): Promise<void>;
  /** Consumo de IA da prévia do texto (`kit_variacao_previas`). Sem esta porta, `previaId` é recusado. */
  previa?: {
    ler(id: string): Promise<{ baseId: string; pecas: number; kitId: string | null } | null>;
    /** Associa a prévia ao kit uma vez só e soma o custo na família do kit (RPC atômica). */
    consumir(a: { previaId: string; kitId: string; chave: string; baseId: string; pecas: number }): Promise<{ ok: boolean; motivo?: string }>;
  };  /** Montar mais com SKU novo no kit existente (`adicionarAoKit`). */
  adicao?: DepsAdicao;
}

/** Montar mais: quantidades por combinação × tamanho; o que já é SKU do kit só aumenta, o resto vira SKU novo. */
export interface AdicionarKitInput {
  kitId: string;
  /** `kits_variacao.versao` lida pela tela: a RPC recusa decisão sobre estado velho. */
  versao?: number;
  quantidades: { cores: string[]; tamanho: string; quantidade: number }[];
  /** Foto por rótulo da combinação nova. Tamanho novo de combinação publicada reaproveita a foto dela. */
  fotos: Record<string, string>;
  /** Galeria das peças (ids mantidos) da combinação nova; tamanho novo de combinação publicada copia a lista da irmã. */
  galeria?: Record<string, string[]>;
  chaveCadastro: string;
}

export interface KitParaAdicionar {
  kitId: string;
  /** Família canônica da base (a mais recente do PAI da base). */
  baseId: string;
  /** Família canônica do kit: onde as variações novas entram (a saga lê o SKU nela). */
  familiaKitId: string;
  pecasPorKit: number;
  preco: number;
  skus: Array<{ codigo: string; cores: string[]; tamanho: string; rotulo: string }>;
  /** Variações da família do kit (a foto de combinação publicada vale para um tamanho novo dela). */
  variacoes: Array<{ codigo: string; cor: string; tamanho: string; imagemPath: string | null; pictureId: string | null; galeria?: FotoPeca[] }>;
  /** Vínculo ML dos SKUs do kit (raiz do PAI do kit). */
  vinculos: Array<{ sku: string; item_externo_id: string | null; user_product_id: string | null; catalog_listing_id: string | null }>;
}

export interface DepsAdicao {
  /** Transferência já criada por esta chave (`kit_transferencias.chave_cadastro`). */
  existente(chave: string): Promise<{ kitId: string; transferenciaId: string; pedidoHash: string | null } | null>;
  /** Por id E org. */
  lerKit(kitId: string): Promise<KitParaAdicionar | null>;
  /**
   * `kit_variacao_adicionar`: confere a versão e grava variação nova, SKU de kit, composição, marca e transferência numa
   * transação (cada item de `novos` leva a linha de `variacoes` em `variacao`). Nada fica fora dela.
   */
  gravar(a: {
    kitId: string; versao: number; familiaId: string; chave: string; hash: string; novos: Linha[];
    existentes: Array<{ codigo: string; quantidade: number }>; baseline: Array<{ codigo: string; ml: number }>; alvos: Linha[];
  }): Promise<ResultadoRpcKit>;
}

export interface SkuKitCriado { codigo: string; rotulo: string; tamanho: string; quantidade: number }

export type ResultadoCriarKitVariacao =
  | { ok: true; kitId: string; transferenciaId: string; existente: boolean; codigoPai?: string; skus?: SkuKitCriado[]; versao?: number; avisos?: string[] }
  | { ok: false; motivo: string; mensagem?: string };

const recusa = (motivo: string, mensagem?: string): ResultadoCriarKitVariacao => ({ ok: false, motivo, mensagem });
const num = (v: unknown) => (v == null ? null : Number(v));
const texto = (v: unknown) => String(v ?? '').trim();

/** Moderação lida no ML: nunca usar a peça nem a foto de item assim (spec, teste de 07/11). */
export function itemModerado(i: { id: string; status: string; subStatus: string[] }): boolean {
  const s = parseStatusML({ id: i.id, status: i.status, sub_status: i.subStatus }).status;
  return s === 'moderado' || s === 'inativo';
}

/**
 * Itens do ML ligados a cada caminho de foto: pela variação, o anúncio Legacy da família (`familias.ml_item_id`), a
 * cópia de catálogo da variação e os filhos UP do SKU (principal e cópia); pela capa, o anúncio da família e todos
 * os filhos do PAI. Sem nenhum desses a foto não está em anúncio.
 */
export function itensPorFoto(e: {
  variacoes: Array<{ imagem_path: string; codigo: string; familia_ml_item_id: string | null; catalog_listing_id: string | null }>;
  capas: Array<{ path: string; codigo_pai: string; ml_item_id: string | null }>;
  filhos: Array<{ sku: string; codigo_pai: string | null; item_externo_id: string | null; catalog_listing_id: string | null }>;
}): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const juntar = (path: string, ...ids: Array<string | null>) => {
    for (const id of ids) {
      if (!id) continue;
      if (!out.has(path)) out.set(path, new Set());
      out.get(path)!.add(id);
    }
  };
  for (const v of e.variacoes) {
    juntar(v.imagem_path, v.familia_ml_item_id, v.catalog_listing_id);
    for (const f of e.filhos) if (f.sku === v.codigo) juntar(v.imagem_path, f.item_externo_id, f.catalog_listing_id);
  }
  for (const c of e.capas) {
    juntar(c.path, c.ml_item_id);
    for (const f of e.filhos) if (f.codigo_pai === c.codigo_pai) juntar(c.path, f.item_externo_id, f.catalog_listing_id);
  }
  return out;
}

/** Moderados numa resposta de `/items/bulk` (envelope antigo). Leitura incompleta lança: sem ela não há prova. */
export function moderadosDoBulk(ids: string[], entradas: unknown): Set<string> {
  if (!Array.isArray(entradas)) throw new Error('ML /items/bulk: resposta inesperada');
  const out = new Set<string>();
  const lidos = new Set<string>();
  for (const e of entradas) {
    const { code, body } = (e ?? {}) as { code?: number; body?: { id?: string; status?: string; sub_status?: string[] } | null };
    if (code !== 200 || !body?.id || !body.status) throw new Error(`ML /items/bulk: item não lido (${code})`);
    lidos.add(body.id);
    if (itemModerado({ id: body.id, status: body.status, subStatus: body.sub_status ?? [] })) out.add(body.id);
  }
  const faltando = ids.filter((id) => !lidos.has(id));
  if (faltando.length > 0) throw new Error(`ML /items/bulk: sem ${faltando.join(', ')}`);
  return out;
}

/**
 * Foto da org: primeira pasta = org (layout novo) ou um usuário da org (legado), sem `..` nem caminho absoluto. Mesma
 * regra da policy de leitura do bucket `imagens`; sem dono comprovado, recusa.
 */
export function fotoDaOrg(path: string, orgId: string, usuariosDaOrg: Set<string>): boolean {
  const partes = path.split('/');
  if (path.startsWith('/') || partes.length < 2 || partes.some((p) => p === '' || p === '.' || p === '..')) return false;
  return partes[0] === orgId || usuariosDaOrg.has(partes[0]);
}

export const MSG_PEDIDO_DIFERENTE = 'Pedido diferente para a mesma chave: este cadastro já foi iniciado com outros dados. '
  + 'Recarregue a tela e confira o kit antes de criar de novo.';

/** Galeria no JSON canônico do hash: `[]` sem galeria (nada é acrescentado), senão `[[rótulo, ids…]…]` ordenado. */
export function galeriaCanonica(galeria: Record<string, string[]> | undefined): Array<Array<[string, string[]]>> {
  const itens = Object.entries(galeria ?? {}).filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, string[]]>;
  return itens.length > 0 ? [itens] : [];
}

/**
 * Hash do pedido (SHA-256 de JSON canônico): base, cores, peças, preço, combinações com quantidade (como conjunto),
 * título, descrição, fotos, meta, tipo de anúncio e "Vender só em kit".
 */
export async function pedidoHash(
  input: CriarKitVariacaoInput, combinacoes: Array<{ rotulo: string; tamanho: string; quantidade: number }>,
): Promise<string> {
  const canonico = JSON.stringify([
    input.familiaBaseId, input.cores, input.pecasPorKit, input.preco,
    combinacoes.map((c) => [c.rotulo, c.tamanho, c.quantidade]).sort((a, b) => String(a).localeCompare(String(b))),
    input.titulo.trim(), input.descricao, Object.entries(input.fotos ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    input.meta, input.listingTypeId ?? 'gold_special', input.soEmKit,
    // Só entra quando há galeria: pedido sem ela mantém o hash de antes (retomada pós-deploy não vira pedido_diferente).
    ...galeriaCanonica(input.galeria),
  ]);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonico)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cor no nível família do kit. `MODEL` é um valor só para o anúncio inteiro e vem da base (nome da planilha, que pode
 * trazer a cor da base): tira as cores da base, da mais longa à mais curta ("Azul Claro" antes de "Azul"), e cai no
 * título se nada sobrar. `MAIN_COLOR` vai "Multicolorido" (toda combinação tem 2+ cores distintas), só se o dicionário
 * da categoria tiver o valor; o `COLOR` livre ("Preto e Azul Claro") não deriva cor principal sozinho no ML.
 */
export function ajustarCorDoKit(
  atributos: AtributoML[], schema: AtributoSchema[], coresBase: string[], titulo: string,
): AtributoML[] {
  const cores = [...new Set(coresBase.filter(Boolean))].sort((a, b) => b.length - a.length);
  const saida = atributos.map((a) => {
    if (a.id !== 'MODEL' || typeof a.value_name !== 'string') return a;
    return { ...a, value_name: removerCorDoSlot(a.value_name, cores) || titulo };
  });
  const multi = schema.find((s) => s.id === 'MAIN_COLOR')?.valores.find((v) => v.nome.toLowerCase() === 'multicolorido');
  return multi ? [...saida, { id: 'MAIN_COLOR', value_id: multi.id }] : saida;
}

interface Combinacao { cores: string[]; rotulo: string; tamanho: string; quantidade: number; componentes: Linha[] }

function validarPedido(input: CriarKitVariacaoInput): string | { combinacoes: Omit<Combinacao, 'componentes'>[] } {
  const { cores, pecasPorKit: n } = input;
  if (!Number.isInteger(n) || n < 2 || n > 6) return 'pecas_invalidas';
  if (!Array.isArray(cores) || cores.some((c) => !texto(c)) || new Set(cores).size !== cores.length || cores.length < n) {
    return 'cores_invalidas';
  }
  if (!(typeof input.preco === 'number' && input.preco > 0)) return 'preco_invalido';
  if (!texto(input.titulo) || input.titulo.length > 60) return 'titulo_invalido';
  if (!texto(input.descricao)) return 'descricao_vazia';
  if (!Number.isInteger(input.meta) || input.meta < 0) return 'meta_invalida';
  if (input.listingTypeId != null && input.listingTypeId !== 'gold_special' && input.listingTypeId !== 'gold_pro') {
    return 'tipo_anuncio_invalido';
  }
  const vistas = new Set<string>();
  const combinacoes: Omit<Combinacao, 'componentes'>[] = [];
  for (const q of input.quantidades ?? []) {
    const cs = normalizarCombinacao(cores, q.cores ?? []);
    if (!cs || cs.length !== n || !texto(q.tamanho) || !Number.isInteger(q.quantidade) || q.quantidade < 0) {
      return 'combinacao_invalida';
    }
    const chave = `${cs.join('|')}#${q.tamanho}`;
    if (vistas.has(chave)) return 'combinacao_repetida';
    vistas.add(chave);
    // Só o que tem quantidade vira SKU (spec, "Criar" 5).
    if (q.quantidade > 0) combinacoes.push({ cores: cs, rotulo: rotuloCombinacao(cs), tamanho: q.tamanho, quantidade: q.quantidade });
  }
  if (combinacoes.length === 0) return 'sem_kit';
  return { combinacoes };
}

/**
 * Depois do kit gravado: passa o consumo de IA da prévia para ele. Idempotente (mesma prévia, mesmo kit). Falha só
 * é registrada: o kit já existe e a repetição da mesma chave tenta de novo.
 */
async function associarPrevia(deps: DepsCriarKitVariacao, input: CriarKitVariacaoInput, kitId: string): Promise<void> {
  if (!input.previaId || !deps.previa) return;
  try {
    const r = await deps.previa.consumir({
      previaId: input.previaId, kitId, chave: input.chaveCadastro, baseId: input.familiaBaseId, pecas: input.pecasPorKit,
    });
    if (!r.ok) console.error('criar_kit_variacao_previa_nao_associada', { previaId: input.previaId, motivo: r.motivo });
  } catch (e) {
    console.error('criar_kit_variacao_previa_falhou', { previaId: input.previaId, erro: String(e) });
  }
}

/** Família do kit: a base clonada sem identidade, resultado nem texto fiscal (a nota usa o título do kit). */
export function montarFamiliaKitVariacao(
  base: Linha, ctx: { loteId: string; codigoPai: string; chave: string; titulo: string; descricao: string; atributos: AtributoML[] },
): Linha {
  const strip = new Set<string>([...STRIP_FAMILIA_KIT, 'descricao_fiscal']);
  const clone = Object.fromEntries(Object.entries(base).filter(([k]) => !strip.has(k)));
  return {
    ...clone,
    lote_id: ctx.loteId, codigo_pai: ctx.codigoPai, chave_cadastro: ctx.chave,
    status: 'pronto', operacao: 'CREATE',
    nome_pai: ctx.titulo, titulo_ml: ctx.titulo, titulo_editado_pelo_operador: true,
    descricao_pai: ctx.descricao, descricao_ml: ctx.descricao, descricao_editada_pelo_operador: true,
    atributos_ml: ctx.atributos,
    // Foto por combinação, no item: COLOR define a foto no ML.
    capa_storage_path: null, capa_ml_picture_id: null,
    descricao_fiscal: null,
    // O consumo de IA do clone é da base; o do kit entra só pela prévia (`kit_variacao_consumir_previa`).
    tokens_input: null, tokens_output: null, custo_centavos: null,
  };
}

/** SKU de kit: custo e peso somados das peças, altura × N (ADR-0151), estoque 0 até o crédito da saga. */
export function montarVariacaoKitVariacao(
  combinacao: Combinacao,
  ctx: { familiaId: string; codigo: string; preco: number; foto: string; pictureId: string; pecas: number; galeria?: FotoPeca[] },
): Linha {
  const [primeira] = combinacao.componentes;
  const clone = Object.fromEntries(Object.entries(primeira).filter(([k]) => !(STRIP_VARIACAO_KIT as readonly string[]).includes(k)));
  const soma = (campo: string) => combinacao.componentes.reduce((t, c) => t + Number(c[campo]), 0);
  return {
    ...clone,
    familia_id: ctx.familiaId, codigo: ctx.codigo, nome: combinacao.rotulo,
    cor: combinacao.rotulo, cor_hex: null, cor_origem: null, cor_editada_pelo_operador: false,
    tamanho: combinacao.tamanho,
    gtin: null, estoque: 0, estoque_anterior: 0,
    custo: Number(soma('custo').toFixed(2)),
    peso_gramas: soma('peso_gramas'),
    altura_cm: num(primeira.altura_cm) == null ? null : Number(primeira.altura_cm) * ctx.pecas,
    largura_cm: num(primeira.largura_cm), comprimento_cm: num(primeira.comprimento_cm),
    preco: ctx.preco, preco_publicacao: ctx.preco, preco_editado_pelo_operador: true, preco_publicado_ml: null,
    imagem_path: ctx.foto, ml_picture_id: ctx.pictureId, ml_variation_id: null,
    galeria_ml_fotos: ctx.galeria ?? [],
    catalog_product_id: null, catalog_listing_id: null, catalog_status: 'pendente', catalog_erro: null,
    excluida_da_publicacao: false, atacado: null,
  };
}

/**
 * Peças das combinações: custo, peso e saldo somado; só user product, um local só (sem Full), nenhum item moderado. A
 * leitura do ML vira o baseline da marca inicial.
 */
async function conferirPecas(
  deps: DepsCriarKitVariacao, base: BaseKit, combinacoes: Combinacao[],
): Promise<{ alvos: Linha[]; baseline: Array<{ codigo: string; ml: number }> } | ResultadoCriarKitVariacao> {
  const pecas = new Map<string, Linha>();
  const precisa = new Map<string, number>();
  for (const c of combinacoes) {
    for (const v of c.componentes) {
      const codigo = v.codigo as string;
      pecas.set(codigo, v);
      precisa.set(codigo, (precisa.get(codigo) ?? 0) + c.quantidade);
    }
  }
  for (const [codigo, v] of pecas) {
    if (!(Number(v.custo) > 0)) return recusa('base_sem_custo', `${codigo} sem custo.`);
    if (!(Number(v.peso_gramas) > 0)) return recusa('base_sem_peso', `${codigo} sem peso.`);
    if (Number(v.estoque) < precisa.get(codigo)!) {
      return recusa('peca_insuficiente', `${codigo}: precisa de ${precisa.get(codigo)}, há ${v.estoque}.`);
    }
  }

  // Só user product (o `/stock` dá 404 em Legacy), um local só (sem Full), nenhum item moderado.
  const alvos: Linha[] = [];
  const baseline: Array<{ codigo: string; ml: number }> = [];
  for (const codigo of pecas.keys()) {
    const vinculo = base.vinculos.find((x) => x.sku === codigo && x.item_externo_id);
    if (!vinculo?.user_product_id) return recusa('base_legacy', `${codigo} não está publicado como user product.`);
    const itemIds = [vinculo.item_externo_id!, ...(vinculo.catalog_listing_id ? [vinculo.catalog_listing_id] : [])];
    const oferta = await deps.lerOferta(vinculo.user_product_id, itemIds);
    if (oferta.locais.some((l) => l.type === 'meli_facility')) return recusa('base_full', `${codigo} está no Full.`);
    if (!oferta.somenteSellingAddress) return recusa('base_multi_origem', `${codigo} tem estoque fora do selling_address.`);
    const mod = oferta.itens.find(itemModerado);
    if (mod) return recusa('base_moderada', `${codigo}: item ${mod.id} moderado no Mercado Livre.`);
    alvos.push({ codigo, up_id: vinculo.user_product_id, item_ids: itemIds });
    baseline.push({ codigo, ml: oferta.quantidade });
  }

  return { alvos, baseline };
}

/** Fotos: da própria org, fora de anúncio moderado, e sobem ao ML agora (só as de `subir`; as outras já têm id). */
async function conferirFotos(
  deps: DepsCriarKitVariacao, paths: string[], subir: string[],
): Promise<Map<string, string> | ResultadoCriarKitVariacao> {
  // O caminho vem do cliente e a edge assina com service role: só foto da própria org (prefixo do bucket).
  const usuarios = new Set(await deps.usuariosDaOrg());
  const alheia = paths.find((path) => !fotoDaOrg(path, deps.orgId, usuarios));
  if (alheia) return recusa('foto_nao_autorizada', `A foto ${alheia} não pertence a esta empresa.`);
  let moderadas: string[];
  try {
    moderadas = await deps.fotosEmItemModerado(paths);
  } catch (e) {
    // Sem leitura completa não há prova de que a foto não está em anúncio moderado: recusa.
    return recusa('foto_moderacao_ilegivel', `Não foi possível conferir as fotos no Mercado Livre: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (moderadas.length > 0) {
    return recusa('foto_moderada', `Foto usada em anúncio moderado no Mercado Livre: ${moderadas.join(', ')}. Use outra.`);
  }

  // A foto sobe agora: depois das reduções da saga, um caminho inválido deixaria as peças sem oferta.
  const pictureIds = new Map<string, string>();
  for (const path of subir) {
    try {
      pictureIds.set(path, await deps.subirFoto(path));
    } catch (e) {
      return recusa('foto_invalida', `Foto ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return pictureIds;
}

export async function criarKitVariacao(
  deps: DepsCriarKitVariacao, input: CriarKitVariacaoInput,
): Promise<ResultadoCriarKitVariacao> {
  const pedido = validarPedido(input);
  if (typeof pedido === 'string') return recusa(pedido);

  // A chave fica presa ao pedido: retomar com outro preço, foto ou quantidade misturaria as duas tentativas.
  const hash = await pedidoHash(input, pedido.combinacoes);
  // Mesmo clique repetido: o kit e a transferência já existem; reenfileirar a saga é inofensivo (claim).
  const ja = await deps.existente(input.chaveCadastro);
  if (ja && ja.pedidoHash !== hash) return recusa('pedido_diferente', MSG_PEDIDO_DIFERENTE);
  if (ja) {
    await associarPrevia(deps, input, ja.kitId);
    if (ja.transferenciaId) await deps.enfileirarSaga(ja.transferenciaId);
    return { ok: true, kitId: ja.kitId, transferenciaId: ja.transferenciaId ?? '', existente: true };
  }

  if (input.previaId) {
    const p = await deps.previa?.ler(input.previaId);
    if (!p) return recusa('previa_invalida', 'A prévia do texto não existe nesta empresa. Gere o texto de novo.');
    if (p.baseId !== input.familiaBaseId || p.pecas !== input.pecasPorKit) {
      return recusa('previa_divergente', 'A prévia do texto é de outro produto ou de outra quantidade de peças.');
    }
    if (p.kitId) {
      // Repetição concorrente da mesma chave: a outra requisição criou o kit e já associou a prévia entre a
      // primeira leitura de `existente` e esta. Mesma chave, mesmo pedido e prévia deste kit = mesma criação.
      const outra = await deps.existente(input.chaveCadastro);
      if (outra && outra.pedidoHash === hash && outra.kitId === p.kitId) {
        if (outra.transferenciaId) await deps.enfileirarSaga(outra.transferenciaId);
        return { ok: true, kitId: outra.kitId, transferenciaId: outra.transferenciaId ?? '', existente: true };
      }
      return recusa('previa_usada', 'A prévia do texto já foi usada em outro kit. Gere o texto de novo.');
    }
  }

  const base = await deps.lerBase(input.familiaBaseId);
  if (!base) return recusa('base_nao_encontrada');
  const { familia } = base;
  if (!kitLigado(familia)) return recusa('modulo_desligado');
  if (!base.canonica) return recusa('base_desatualizada', 'Use a versão mais recente do produto.');
  if (familia.kit_multiplicador != null) return recusa('base_e_kit');
  if (!familia.categoria_ml_id) return recusa('base_sem_categoria');
  if (familia.origem !== 'nacional' && familia.origem !== 'importado') {
    return recusa('origem_ausente', 'A origem (NACIONAL ou IMPORTADO) da base precisa estar confirmada.');
  }

  // Peças de cada combinação: a variação da base com a cor e o tamanho.
  const combinacoes: Combinacao[] = [];
  for (const c of pedido.combinacoes) {
    const componentes: Linha[] = [];
    for (const cor of c.cores) {
      const v = base.variacoes.find((x) => texto(x.cor) === texto(cor) && texto(x.tamanho) === texto(c.tamanho));
      if (!v) return recusa('sku_inexistente', `A base não tem ${cor} no tamanho ${c.tamanho}.`);
      componentes.push(v);
    }
    combinacoes.push({ ...c, componentes });
  }
  const conferidas = await conferirPecas(deps, base, combinacoes);
  if ('ok' in conferidas) return conferidas;
  const { alvos, baseline } = conferidas;

  const faltaFoto = combinacoes.find((c) => !texto(input.fotos?.[c.rotulo]));
  if (faltaFoto) return recusa('sem_foto', `Falta a foto de ${faltaFoto.rotulo}.`);
  const paths = [...new Set(combinacoes.map((c) => input.fotos[c.rotulo]))];
  const pictureIds = await conferirFotos(deps, paths, paths);
  if ('ok' in pictureIds) return pictureIds;

  try {
    await deps.exigirFiscal(familia);
  } catch (e) {
    return recusa('fiscal_incompleto', e instanceof Error ? e.message : String(e));
  }

  // SIZE exige guia da própria conta (2610 sem guia, 2617 com a de outro vendedor).
  const tamanhos = [...new Set(combinacoes.map((c) => c.tamanho))];
  if (!familia.genero || !gradeDaFamilia((familia.grade_tamanho as string | null) ?? null, tamanhos)) {
    return recusa('sem_guia_tamanho', 'A base precisa de gênero e grade de tamanho para a guia de medidas.');
  }
  try {
    await deps.garantirGuia(familia, tamanhos);
  } catch (e) {
    return recusa('sem_guia_tamanho', e instanceof Error ? e.message : String(e));
  }

  // Categoria e atributos da base, sem IA. COLOR vai por SKU (o rótulo da combinação). Formato "Kit" e
  // quantidade só em categoria que tem SALE_FORMAT (MLB3112 não tem; ADR-0071).
  const schema = await deps.lerSchema(familia.categoria_ml_id as string);
  let atributos = ajustarCorDoKit(
    ((familia.atributos_ml as AtributoML[] | null) ?? []).filter((a) => a.id !== 'COLOR' && a.id !== 'MAIN_COLOR'),
    schema, base.variacoes.map((v) => texto(v.cor)), input.titulo.trim(),
  );
  if (schema.some((s) => s.id === 'SALE_FORMAT')) {
    try {
      atributos = aplicarKitNosAtributos(schema, atributos, input.pecasPorKit);
    } catch (e) {
      return recusa('categoria_sem_kit', e instanceof Error ? e.message : String(e));
    }
  }

  // Retomada: a mesma chave reaproveita a família e as variações que uma tentativa anterior gravou (a família
  // tem `chave_cadastro` única por org). Só o que falta é gravado; nada é apagado sem resultado definitivo.
  const parcial = await deps.parcial(input.chaveCadastro);
  if (parcial && parcial.pedidoHash !== hash) return recusa('pedido_diferente', MSG_PEDIDO_DIFERENTE);
  if (parcial) {
    const pedidos = new Set(combinacoes.map((c) => `${c.rotulo}#${c.tamanho}`));
    const sobra = parcial.variacoes.find((v) => !pedidos.has(`${v.cor}#${v.tamanho}`));
    if (sobra) return recusa('cadastro_parcial_divergente', `A tentativa anterior gravou ${sobra.codigo}, fora deste pedido. Use outra chave.`);
  }
  const existentes = new Map((parcial?.variacoes ?? []).map((v) => [`${v.cor}#${v.tamanho}`, v.codigo]));
  // Retomada: combinação que já tem tamanho gravado mantém a lista dele (todos os tamanhos da combinação, mesma galeria).
  const jaGravadas = new Map<string, FotoPeca[]>();
  for (const v of parcial?.variacoes ?? []) if (v.cor && v.galeria && !jaGravadas.has(v.cor)) jaGravadas.set(v.cor, v.galeria);
  const galerias = await resolverGalerias(deps, combinacoes, input.galeria, base, familia.categoria_ml_id as string, jaGravadas);
  const faltam = combinacoes.filter((c) => !existentes.has(`${c.rotulo}#${c.tamanho}`));
  const reserva = parcial && faltam.length === 0 ? null
    : await deps.reservarCodigos(faltam.length + 1);   // 1 PAI + N; na retomada o PAI reservado sobra
  const codigoPai = parcial?.codigoPai ?? reserva!.codigoPai;
  const novos = [...(reserva?.codigos ?? [])];
  const codigos = combinacoes.map((c) => existentes.get(`${c.rotulo}#${c.tamanho}`) ?? novos.shift()!);

  const loteId = parcial?.loteId ?? await deps.gravar.lote();
  let familiaId: string | null = parcial?.familiaId ?? null;
  try {
    familiaId ??= await deps.gravar.familia({
      ...montarFamiliaKitVariacao(familia, {
        loteId, codigoPai, chave: input.chaveCadastro, titulo: input.titulo.trim(), descricao: input.descricao, atributos,
      }),
      kit_variacao_pedido: hash,
    });
    // Repetição concorrente da mesma chave: a outra requisição pode ter gravado a mesma combinação depois da
    // leitura do parcial. A RPC relê sob o lock da família e devolve o código que ficou valendo.
    const indices = combinacoes.flatMap((c, i) => (existentes.has(`${c.rotulo}#${c.tamanho}`) ? [] : [i]));
    if (indices.length > 0) {
      const finais = await deps.gravar.variacoes(familiaId, indices.map((i) => montarVariacaoKitVariacao(combinacoes[i], {
        familiaId: familiaId!, codigo: codigos[i], preco: input.preco, foto: input.fotos[combinacoes[i].rotulo],
        pictureId: pictureIds.get(input.fotos[combinacoes[i].rotulo])!, pecas: input.pecasPorKit,
        galeria: galerias.porRotulo.get(combinacoes[i].rotulo),
      })));
      if (finais.length !== indices.length) throw new Error('variações do kit: resposta inesperada');
      indices.forEach((i, k) => { codigos[i] = finais[k]; });
    }
  } catch (e) {
    // Incerto (o insert pode ter gravado): mantém o parcial; a repetição com a mesma chave retoma.
    return recusa('falha_gravar', `${e instanceof Error ? e.message : String(e)}. Tente de novo: o cadastro é retomado.`);
  }

  let r: ResultadoRpcKit;
  try {
    r = await deps.gravar.kit({
    chave: input.chaveCadastro,
    kit: {
      codigo_pai_base: familia.codigo_pai, codigo_pai_kit: codigoPai, pecas_por_kit: input.pecasPorKit,
      preco: input.preco, meta: input.meta, listing_type_id: input.listingTypeId ?? 'gold_special', pedido_hash: hash,
      // Task 14: a RPC guarda os componentes antes de criar a montagem; a montagem pausa e confirma antes de usar.
      so_em_kit: input.soEmKit === true,
    },
    skus: combinacoes.map((c, i) => ({
      codigo: codigos[i], tamanho: c.tamanho, cores: c.cores, rotulo_cor: c.rotulo, quantidade: c.quantidade,
      componentes: c.componentes.map((v) => ({ codigo: v.codigo, quantidade: 1 })),
    })),
    baseline, alvos,
    });
  } catch (e) {
    // Resultado incerto: o estado durável decide. Kit gravado segue; senão o parcial fica para a retomada.
    const ja = await deps.existente(input.chaveCadastro).catch(() => null);
    if (!ja?.transferenciaId) {
      return recusa('falha_gravar', `${e instanceof Error ? e.message : String(e)}. Tente de novo: o cadastro é retomado.`);
    }
    if (ja.pedidoHash !== hash) return recusa('pedido_diferente', MSG_PEDIDO_DIFERENTE);
    r = { ok: true, kit_id: ja.kitId, transferencia_id: ja.transferenciaId, existente: true };
  }
  if (r.ok && r.existente && r.kit_id) {
    // Outra requisição (ou a anterior) com a mesma chave gravou o kit: a família é a mesma, nada a apagar.
    await associarPrevia(deps, input, r.kit_id);
    if (r.transferencia_id) await deps.enfileirarSaga(r.transferencia_id);
    return { ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id ?? '', existente: true };
  }
  // Recusa definitiva da RPC (nada do kit foi gravado): família e variações desta chave saem.
  if (!r.ok || !r.transferencia_id || !r.kit_id) {
    await deps.gravar.desfazer(loteId, familiaId);
    return recusa(r.motivo ?? 'falha_gravar', r.mensagem ?? r.codigo);
  }
  await associarPrevia(deps, input, r.kit_id);
  await deps.enfileirarSaga(r.transferencia_id);
  return {
    ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id, existente: !!r.existente, codigoPai,
    skus: combinacoes.map((c, i) => ({ codigo: codigos[i], rotulo: c.rotulo, tamanho: c.tamanho, quantidade: c.quantidade })),
    ...(galerias.avisos.length > 0 ? { avisos: galerias.avisos } : {}),
  };
}

/**
 * ADR-0200 (adendo 12/11): galeria por rótulo. O servidor recalcula a proposta com a peça do 1º tamanho de cada cor e
 * grava `proposta ∩ pedido` na ordem da proposta (o cliente só remove). Nunca recusa o kit: qualquer falha vira aviso e
 * a combinação sai só com a foto do kit. Combinação com irmã já gravada (retomada, tamanho novo) reusa a lista dela.
 */
async function resolverGalerias(
  deps: DepsCriarKitVariacao, combinacoes: Combinacao[], pedido: Record<string, string[]> | undefined, base: BaseKit,
  categoriaId: string, jaGravadas: Map<string, FotoPeca[]>,
): Promise<{ porRotulo: Map<string, FotoPeca[]>; avisos: string[] }> {
  const porRotulo = new Map<string, FotoPeca[]>();
  const avisos: string[] = [];
  for (const rotulo of new Set(combinacoes.map((c) => c.rotulo))) {
    const gravada = jaGravadas.get(rotulo);
    if (gravada) { porRotulo.set(rotulo, gravada); continue; }
    const ids = pedido?.[rotulo];
    if (!Array.isArray(ids) || ids.length === 0 || !deps.lerGaleria) continue;
    const c = combinacoes.find((x) => x.rotulo === rotulo)!;
    const doBase = base.variacoes.map((v) => ({ codigo: texto(v.codigo), cor: texto(v.cor) }));
    const pecas = c.cores.map((cor) => ({ cor, itemId: pecaDaCor(doBase, base.vinculos, texto(cor)) ?? '' }));
    if (pecas.some((p) => !p.itemId)) { avisos.push(`${rotulo}: peça sem anúncio no Mercado Livre; só a foto do kit.`); continue; }
    try {
      const proposta = await deps.lerGaleria(pecas, categoriaId);
      avisos.push(...proposta.avisos);
      if (proposta.indisponivel) continue;
      const mantidas = new Set(ids);
      porRotulo.set(rotulo, proposta.fotos.filter((f) => mantidas.has(f.id)));
    } catch (e) {
      avisos.push(`${rotulo}: fotos das peças indisponíveis (${e instanceof Error ? e.message : String(e)}); só a foto do kit.`);
    }
  }
  return { porRotulo, avisos };
}

const conjunto = (cores: string[]) => [...cores].map(texto).sort().join('|');

/**
 * ADR-0200 (Task 13, ajuste): Montar mais. Combinação × tamanho já publicado só aumenta o saldo; nunca publicado vira
 * SKU novo no MESMO kit e na família do kit, criado pela saga (alvo `criar`, passo `aumentar`), como na criação. Uma
 * transferência só para os dois (`kit_variacao_adicionar`), com as mesmas garantias: peças conferidas no ML, foto da
 * org fora de moderação, guia, fiscal, marca inicial, `comRetryConcorrencia` e chave idempotente com o hash.
 *
 * Combinação = conjunto de cores + tamanho. Tamanho novo de combinação publicada usa as cores e o rótulo gravados
 * (o COLOR em texto precisa ser idêntico para o seletor) e a foto dela.
 */
export async function adicionarAoKit(deps: DepsCriarKitVariacao, input: AdicionarKitInput): Promise<ResultadoCriarKitVariacao> {
  const ad = deps.adicao;
  if (!ad) throw new Error('adicionarAoKit sem as portas de adição');
  if (!Number.isInteger(input.versao)) return recusa('versao', 'O kit mudou em outra tela. Feche e abra de novo.');

  const vistas = new Set<string>();
  const pedidos: Array<{ cores: string[]; tamanho: string; quantidade: number }> = [];
  for (const q of input.quantidades ?? []) {
    const cs = (q.cores ?? []).map(texto);
    if (cs.some((c) => !c) || new Set(cs).size !== cs.length || !texto(q.tamanho) || !Number.isInteger(q.quantidade) || q.quantidade < 0) {
      return recusa('combinacao_invalida');
    }
    const chave = `${conjunto(cs)}#${texto(q.tamanho)}`;
    if (vistas.has(chave)) return recusa('combinacao_repetida');
    vistas.add(chave);
    if (q.quantidade > 0) pedidos.push({ cores: cs, tamanho: texto(q.tamanho), quantidade: q.quantidade });
  }
  if (pedidos.length === 0) return recusa('sem_kit');

  const canonico = JSON.stringify([
    input.kitId,
    pedidos.map((p) => [conjunto(p.cores), p.tamanho, p.quantidade]).sort((a, b) => String(a).localeCompare(String(b))),
    Object.entries(input.fotos ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ...galeriaCanonica(input.galeria),
  ]);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonico)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  const ja = await ad.existente(input.chaveCadastro);
  if (ja && (ja.pedidoHash !== hash || ja.kitId !== input.kitId)) return recusa('pedido_diferente', MSG_PEDIDO_DIFERENTE);
  if (ja) {
    await deps.enfileirarSaga(ja.transferenciaId);
    return { ok: true, kitId: ja.kitId, transferenciaId: ja.transferenciaId, existente: true };
  }

  const kit = await ad.lerKit(input.kitId);
  if (!kit) return recusa('kit_nao_encontrado', 'Kit não encontrado.');
  if (pedidos.some((p) => p.cores.length !== kit.pecasPorKit)) return recusa('combinacao_invalida');
  const base = await deps.lerBase(kit.baseId);
  if (!base) return recusa('base_nao_encontrada');
  const { familia } = base;
  if (!kitLigado(familia)) return recusa('modulo_desligado');
  if (!familia.categoria_ml_id) return recusa('base_sem_categoria');
  const coresBase = [...new Set(base.variacoes.map((v) => texto(v.cor)))];

  // Publicado (SKU do kit) ou novo. Novo reaproveita cores e rótulo de combinação já publicada em outro tamanho.
  const existentes: Array<{ codigo: string; quantidade: number }> = [];
  const novas: Combinacao[] = [];
  const todas: Combinacao[] = [];
  for (const p of pedidos) {
    const doKit = kit.skus.find((s) => conjunto(s.cores) === conjunto(p.cores) && texto(s.tamanho) === p.tamanho);
    const irmao = kit.skus.find((s) => conjunto(s.cores) === conjunto(p.cores));
    const cores = doKit?.cores ?? irmao?.cores ?? coresBase.filter((c) => p.cores.includes(c));
    if (cores.length !== kit.pecasPorKit) return recusa('sku_inexistente', `A base não tem as cores ${p.cores.join(', ')}.`);
    const componentes: Linha[] = [];
    for (const cor of cores) {
      const v = base.variacoes.find((x) => texto(x.cor) === texto(cor) && texto(x.tamanho) === p.tamanho);
      if (!v) return recusa('sku_inexistente', `A base não tem ${cor} no tamanho ${p.tamanho}.`);
      componentes.push(v);
    }
    const c: Combinacao = {
      cores, rotulo: doKit?.rotulo ?? irmao?.rotulo ?? rotuloCombinacao(cores), tamanho: p.tamanho, quantidade: p.quantidade, componentes,
    };
    todas.push(c);
    if (doKit) existentes.push({ codigo: doKit.codigo, quantidade: p.quantidade });
    else novas.push(c);
  }

  const conferidas = await conferirPecas(deps, base, todas);
  if ('ok' in conferidas) return conferidas;
  const alvos = [...conferidas.alvos];
  for (const e of existentes) {
    const v = kit.vinculos.find((x) => x.sku === e.codigo && x.item_externo_id);
    if (!v?.user_product_id) return recusa('sku_sem_anuncio', `${e.codigo} sem anúncio no Mercado Livre.`);
    alvos.push({ codigo: e.codigo, up_id: v.user_product_id, item_ids: [v.item_externo_id!, ...(v.catalog_listing_id ? [v.catalog_listing_id] : [])] });
  }

  // Foto: combinação nova exige a dela; tamanho novo de combinação publicada usa a foto da combinação.
  const fotoDe = new Map<string, { path: string; pictureId: string | null }>();
  for (const c of novas) {
    const enviada = texto(input.fotos?.[c.rotulo]);
    const publicada = kit.variacoes.find((v) => v.cor === c.rotulo && kit.skus.some((s) => s.codigo === v.codigo) && v.imagemPath);
    if (enviada) fotoDe.set(c.rotulo, { path: enviada, pictureId: null });
    else if (publicada) fotoDe.set(c.rotulo, { path: publicada.imagemPath!, pictureId: publicada.pictureId });
    else return recusa('sem_foto', `Falta a foto de ${c.rotulo}.`);
  }
  const fotos = [...fotoDe.values()];
  const subir = [...new Set(fotos.filter((f) => !f.pictureId).map((f) => f.path))];
  const pictureIds = await conferirFotos(deps, [...new Set(fotos.map((f) => f.path))], subir);
  if ('ok' in pictureIds) return pictureIds;

  if (novas.length > 0) {
    try {
      await deps.exigirFiscal(familia);
    } catch (e) {
      return recusa('fiscal_incompleto', e instanceof Error ? e.message : String(e));
    }
    // Mesma guia para todos os tamanhos da família do kit.
    const tamanhos = [...new Set([...kit.skus.map((s) => s.tamanho), ...novas.map((c) => c.tamanho)])];
    if (!familia.genero || !gradeDaFamilia((familia.grade_tamanho as string | null) ?? null, tamanhos)) {
      return recusa('sem_guia_tamanho', 'A base precisa de gênero e grade de tamanho para a guia de medidas.');
    }
    try {
      await deps.garantirGuia(familia, tamanhos);
    } catch (e) {
      return recusa('sem_guia_tamanho', e instanceof Error ? e.message : String(e));
    }
  }

  // Códigos novos (o PAI reservado sobra). A linha da variação vai para a RPC: variação, SKU de kit, composição e
  // transferência nascem juntos, sem janela de variação na família publicada sem SKU de kit.
  // Galeria: tamanho novo de combinação publicada copia a lista da irmã; combinação nova recalcula (cliente só remove).
  const irmas = new Map<string, FotoPeca[]>();
  for (const v of kit.variacoes) if (v.galeria && kit.skus.some((s) => s.codigo === v.codigo) && !irmas.has(v.cor)) irmas.set(v.cor, v.galeria);
  const galerias = await resolverGalerias(deps, novas, input.galeria, base, familia.categoria_ml_id as string, irmas);

  const reserva = novas.length > 0 ? await deps.reservarCodigos(novas.length + 1) : null;
  const codigos = [...(reserva?.codigos ?? [])];
  const novos = novas.map((c, i) => {
    const f = fotoDe.get(c.rotulo)!;
    return {
      codigo: codigos[i], tamanho: c.tamanho, cores: c.cores, rotulo_cor: c.rotulo, quantidade: c.quantidade,
      componentes: c.componentes.map((v) => ({ codigo: v.codigo, quantidade: 1 })),
      variacao: montarVariacaoKitVariacao(c, {
        familiaId: kit.familiaKitId, codigo: codigos[i], preco: kit.preco, foto: f.path,
        pictureId: f.pictureId ?? pictureIds.get(f.path)!, pecas: kit.pecasPorKit,
        galeria: galerias.porRotulo.get(c.rotulo),
      }),
    };
  });

  let r: ResultadoRpcKit;
  try {
    r = await ad.gravar({
      kitId: kit.kitId, versao: input.versao as number, familiaId: kit.familiaKitId, chave: input.chaveCadastro, hash,
      existentes, baseline: conferidas.baseline, alvos, novos,
    });
  } catch (e) {
    const outra = await ad.existente(input.chaveCadastro).catch(() => null);
    if (!outra) return recusa('falha_gravar', `${e instanceof Error ? e.message : String(e)}. Tente de novo: o pedido é retomado.`);
    if (outra.pedidoHash !== hash) return recusa('pedido_diferente', MSG_PEDIDO_DIFERENTE);
    r = { ok: true, kit_id: outra.kitId, transferencia_id: outra.transferenciaId, existente: true };
  }
  if (!r.ok || !r.transferencia_id) {
    return recusa(r.motivo ?? 'falha_gravar', r.motivo === 'versao' ? 'O kit mudou em outra tela. Feche e abra de novo.' : r.mensagem ?? r.codigo);
  }
  await deps.enfileirarSaga(r.transferencia_id);
  return {
    ok: true, kitId: kit.kitId, transferenciaId: r.transferencia_id, existente: !!r.existente, versao: r.versao,
    skus: novas.map((c, i) => ({ codigo: codigos[i], rotulo: c.rotulo, tamanho: c.tamanho, quantidade: c.quantidade })),
    ...(galerias.avisos.length > 0 ? { avisos: galerias.avisos } : {}),
  };
}
