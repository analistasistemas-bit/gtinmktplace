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
  /** Clássico (padrão, como em `publicar-familias`) ou Premium: muda a comissão que o simulador cota. */
  listingTypeId?: 'gold_special' | 'gold_pro';
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

/** Cadastro parcial de uma tentativa anterior com a mesma chave (família gravada, kit não). */
export interface CadastroParcial {
  familiaId: string;
  loteId: string;
  codigoPai: string;
  variacoes: Array<{ codigo: string; cor: string | null; tamanho: string | null }>;
}

export interface DepsCriarKitVariacao {
  /** Org autenticada: dona das fotos (`{org_id}/...`). */
  orgId: string;
  /** Usuários da org: o layout legado do bucket é `{user_id}/...` (policy "imagens: select org"). */
  usuariosDaOrg(): Promise<string[]>;
  lerBase(familiaId: string): Promise<BaseKit | null>;
  /** Família do kit já gravada por uma tentativa anterior com a mesma chave (`familias.chave_cadastro`). */
  parcial(chave: string): Promise<CadastroParcial | null>;
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
  /** Sobe a foto ao ML e devolve o `picture_id`; lança se o caminho não existe ou o ML recusa. */
  subirFoto(path: string): Promise<string>;
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
  combinacao: Combinacao,
  ctx: { familiaId: string; codigo: string; preco: number; foto: string; pictureId: string; pecas: number },
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
  for (const path of paths) {
    try {
      pictureIds.set(path, await deps.subirFoto(path));
    } catch (e) {
      return recusa('foto_invalida', `Foto ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
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

  // Retomada: a mesma chave reaproveita a família e as variações que uma tentativa anterior gravou (a família
  // tem `chave_cadastro` única por org). Só o que falta é gravado; nada é apagado sem resultado definitivo.
  const parcial = await deps.parcial(input.chaveCadastro);
  if (parcial) {
    const pedidos = new Set(combinacoes.map((c) => `${c.rotulo}#${c.tamanho}`));
    const sobra = parcial.variacoes.find((v) => !pedidos.has(`${v.cor}#${v.tamanho}`));
    if (sobra) return recusa('cadastro_parcial_divergente', `A tentativa anterior gravou ${sobra.codigo}, fora deste pedido. Use outra chave.`);
  }
  const existentes = new Map((parcial?.variacoes ?? []).map((v) => [`${v.cor}#${v.tamanho}`, v.codigo]));
  const faltam = combinacoes.filter((c) => !existentes.has(`${c.rotulo}#${c.tamanho}`));
  const reserva = parcial && faltam.length === 0 ? null
    : await deps.reservarCodigos(faltam.length + 1);   // 1 PAI + N; na retomada o PAI reservado sobra
  const codigoPai = parcial?.codigoPai ?? reserva!.codigoPai;
  const novos = [...(reserva?.codigos ?? [])];
  const codigos = combinacoes.map((c) => existentes.get(`${c.rotulo}#${c.tamanho}`) ?? novos.shift()!);

  const loteId = parcial?.loteId ?? await deps.gravar.lote();
  let familiaId: string | null = parcial?.familiaId ?? null;
  try {
    familiaId ??= await deps.gravar.familia(montarFamiliaKitVariacao(familia, {
      loteId, codigoPai, chave: input.chaveCadastro, titulo: input.titulo.trim(), descricao: input.descricao, atributos,
    }));
    for (const [i, c] of combinacoes.entries()) {
      if (existentes.has(`${c.rotulo}#${c.tamanho}`)) continue;
      await deps.gravar.variacao(montarVariacaoKitVariacao(c, {
        familiaId, codigo: codigos[i], preco: input.preco, foto: input.fotos[c.rotulo],
        pictureId: pictureIds.get(input.fotos[c.rotulo])!, pecas: input.pecasPorKit,
      }));
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
      preco: input.preco, meta: input.meta, listing_type_id: input.listingTypeId ?? 'gold_special',
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
    r = { ok: true, kit_id: ja.kitId, transferencia_id: ja.transferenciaId, existente: true };
  }
  if (r.ok && r.existente && r.kit_id) {
    // Outra requisição (ou a anterior) com a mesma chave gravou o kit: a família é a mesma, nada a apagar.
    if (r.transferencia_id) await deps.enfileirarSaga(r.transferencia_id);
    return { ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id ?? '', existente: true };
  }
  // Recusa definitiva da RPC (nada do kit foi gravado): família e variações desta chave saem.
  if (!r.ok || !r.transferencia_id || !r.kit_id) {
    await deps.gravar.desfazer(loteId, familiaId);
    return recusa(r.motivo ?? 'falha_gravar', r.mensagem ?? r.codigo);
  }
  await deps.enfileirarSaga(r.transferencia_id);
  return {
    ok: true, kitId: r.kit_id, transferenciaId: r.transferencia_id, existente: !!r.existente, codigoPai,
    skus: combinacoes.map((c, i) => ({ codigo: codigos[i], rotulo: c.rotulo, tamanho: c.tamanho, quantidade: c.quantidade })),
  };
}
