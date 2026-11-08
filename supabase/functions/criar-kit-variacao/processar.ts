// ADR-0197 (Task 10): cria o kit com variação a partir de uma família publicada em user products.
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
import { kitLigado } from '../_shared/kit-variacao/politica.ts';
import type { OfertaUP } from '../_shared/kit-variacao/ml-oferta.ts';
import { normalizarCombinacao, rotuloCombinacao } from '../_shared/kit-variacao/combinacoes.ts';
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
  soEmKit: boolean;
  meta: number;
  chaveCadastro: string;
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
}

export interface DepsCriarKitVariacao {
  lerBase(familiaId: string): Promise<BaseKit | null>;
  existente(chave: string): Promise<{ kitId: string; transferenciaId: string | null } | null>;
  lerOferta(upId: string, itemIds: string[]): Promise<OfertaUP>;
  /** Caminhos de foto usados por algum item moderado (`under_review`, `forbidden`, `waiting_for_patch`), lido no ML. */
  fotosEmItemModerado(paths: string[]): Promise<string[]>;
  /** ADR-0135 D-7: lança com a mensagem quando o cadastro fiscal da base está incompleto. */
  exigirFiscal(familia: Linha): Promise<void>;
  lerSchema(categoriaId: string): Promise<AtributoSchema[]>;
  /** Resolve (ou cria) a guia de tamanhos da própria conta para a categoria e os tamanhos; lança se não der. */
  garantirGuia(familia: Linha, tamanhos: string[]): Promise<void>;
  reservarCodigos(qtd: number): Promise<{ codigoPai: string; codigos: string[] }>;
  gravar: {
    lote(): Promise<string>;
    familia(linha: Linha): Promise<string>;
    /** Com `comRetryConcorrencia` (40001 `canonica_trocou`). */
    variacao(linha: Linha): Promise<void>;
    kit(args: { chave: string; kit: Linha; skus: Linha[]; baseline: Array<{ codigo: string; ml: number }>; alvos: Linha[] }): Promise<ResultadoRpcKit>;
    desfazer(loteId: string, familiaId: string | null): Promise<void>;
  };
  enfileirarSaga(transferenciaId: string): Promise<void>;
}

export interface SkuKitCriado { codigo: string; rotulo: string; tamanho: string; quantidade: number }

export type ResultadoCriarKitVariacao =
  | { ok: true; kitId: string; transferenciaId: string; existente: boolean; codigoPai?: string; skus?: SkuKitCriado[] }
  | { ok: false; motivo: string; mensagem?: string };

const recusa = (motivo: string, mensagem?: string): ResultadoCriarKitVariacao => ({ ok: false, motivo, mensagem });
const num = (v: unknown) => (v == null ? null : Number(v));
const texto = (v: unknown) => String(v ?? '').trim();

/** Moderação lida no ML: nunca usar a peça nem a foto de item assim (spec, teste de 07/11). */
export function itemModerado(i: { id: string; status: string; subStatus: string[] }): boolean {
  const s = parseStatusML({ id: i.id, status: i.status, sub_status: i.subStatus }).status;
  return s === 'moderado' || s === 'inativo';
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
  // ponytail: a transição Normal → Guardado (pausar os individuais) é da Task 14; até lá o kit nasce sem a opção.
  if (input.soEmKit) return 'so_em_kit_indisponivel';
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
  };
}

/** SKU de kit: custo e peso somados das peças, altura × N (ADR-0151), estoque 0 até o crédito da saga. */
export function montarVariacaoKitVariacao(
  combinacao: Combinacao, ctx: { familiaId: string; codigo: string; preco: number; foto: string; pecas: number },
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
    imagem_path: ctx.foto, ml_picture_id: null, ml_variation_id: null,
    catalog_product_id: null, catalog_listing_id: null, catalog_status: 'pendente', catalog_erro: null,
    excluida_da_publicacao: false, atacado: null,
  };
}

export async function criarKitVariacao(
  deps: DepsCriarKitVariacao, input: CriarKitVariacaoInput,
): Promise<ResultadoCriarKitVariacao> {
  const pedido = validarPedido(input);
  if (typeof pedido === 'string') return recusa(pedido);

  // Mesmo clique repetido: o kit e a transferência já existem; reenfileirar a saga é inofensivo (claim).
  const ja = await deps.existente(input.chaveCadastro);
  if (ja) {
    if (ja.transferenciaId) await deps.enfileirarSaga(ja.transferenciaId);
    return { ok: true, kitId: ja.kitId, transferenciaId: ja.transferenciaId ?? '', existente: true };
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

  const faltaFoto = combinacoes.find((c) => !texto(input.fotos?.[c.rotulo]));
  if (faltaFoto) return recusa('sem_foto', `Falta a foto de ${faltaFoto.rotulo}.`);
  const paths = [...new Set(combinacoes.map((c) => input.fotos[c.rotulo]))];
  const moderadas = await deps.fotosEmItemModerado(paths);
  if (moderadas.length > 0) {
    return recusa('foto_moderada', `Foto usada em anúncio moderado no Mercado Livre: ${moderadas.join(', ')}. Use outra.`);
  }

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
  let atributos = ((familia.atributos_ml as AtributoML[] | null) ?? []).filter((a) => a.id !== 'COLOR' && a.id !== 'MAIN_COLOR');
  if (schema.some((s) => s.id === 'SALE_FORMAT')) {
    try {
      atributos = aplicarKitNosAtributos(schema, atributos, input.pecasPorKit);
    } catch (e) {
      return recusa('categoria_sem_kit', e instanceof Error ? e.message : String(e));
    }
  }

  const { codigoPai, codigos } = await deps.reservarCodigos(1 + combinacoes.length);
  const loteId = await deps.gravar.lote();
  let familiaId: string | null = null;
  try {
    familiaId = await deps.gravar.familia(montarFamiliaKitVariacao(familia, {
      loteId, codigoPai, chave: input.chaveCadastro, titulo: input.titulo.trim(), descricao: input.descricao, atributos,
    }));
    for (const [i, c] of combinacoes.entries()) {
      await deps.gravar.variacao(montarVariacaoKitVariacao(c, {
        familiaId, codigo: codigos[i], preco: input.preco, foto: input.fotos[c.rotulo], pecas: input.pecasPorKit,
      }));
    }
  } catch (e) {
    await deps.gravar.desfazer(loteId, familiaId);
    return recusa('falha_gravar', e instanceof Error ? e.message : String(e));
  }

  const r = await deps.gravar.kit({
    chave: input.chaveCadastro,
    kit: {
      codigo_pai_base: familia.codigo_pai, codigo_pai_kit: codigoPai, pecas_por_kit: input.pecasPorKit,
      preco: input.preco, meta: input.meta,
    },
    skus: combinacoes.map((c, i) => ({
      codigo: codigos[i], tamanho: c.tamanho, cores: c.cores, rotulo_cor: c.rotulo, quantidade: c.quantidade,
      componentes: c.componentes.map((v) => ({ codigo: v.codigo, quantidade: 1 })),
    })),
    baseline, alvos,
  });
  // Recusa, ou outra requisição com a mesma chave criou antes: a família e as variações desta saem.
  if (!r.ok || !r.transferencia_id || !r.kit_id || r.existente) {
    await deps.gravar.desfazer(loteId, familiaId);
    if (r.ok && r.existente && r.kit_id) {
      return { ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id ?? '', existente: true };
    }
    return recusa(r.motivo ?? 'falha_gravar', r.mensagem ?? r.codigo);
  }
  await deps.enfileirarSaga(r.transferencia_id);
  return {
    ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id, existente: !!r.existente, codigoPai,
    skus: combinacoes.map((c, i) => ({ codigo: codigos[i], rotulo: c.rotulo, tamanho: c.tamanho, quantidade: c.quantidade })),
  };
}
