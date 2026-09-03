// ADR-0151: cria as famílias de kit vinculado a partir de uma família-base.
//
// NÃO roda `process-familia` (D-3): a família nasce copiando categoria/atributos/descrição
// da base, já em `status='pronto'`. Se rodasse depois, título/preço/atributos poderiam
// divergir do preview que o operador confirmou, furando a revisão humana (D-4).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { aplicarKitNosAtributos, type AtributoML } from '../_shared/categoria/atributos.ts';
import type { AtributoSchema } from '../_shared/categoria/schema.ts';
import { derivarCodigos, codigosJaUsados } from '../_shared/produto/codigos.ts';
import { listarKitsVivos } from '../_shared/estoque/kit.ts';

export interface KitSolicitado {
  multiplicador: number;
  chaveCadastro: string;
  titulo: string;
  descricao: string;
  preco: number;
  gtin: string | null;
  imagemPath: string | null;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
  atacado: unknown[] | null;
}

export interface CriarKitInput {
  familiaBaseId: string;
  kits: KitSolicitado[];
}

export interface KitCriado {
  familiaId: string;
  codigoPai: string;
  codigo: string;
  multiplicador: number;
}

export interface ResultadoCriarKits {
  ok: boolean;
  motivo?: string;
  mensagem?: string;
  kits?: KitCriado[];
  /**
   * Resultado do encadeamento de publicação (quando a base já está publicada). `resp.ok`
   * sozinho é falso positivo — ver `deps.encadearPublicacao`/`adicionar-variacoes-familia/
   * index.ts:32-35` — então este bool viaja explícito até a resposta HTTP em vez de o
   * `{ok:true}` externo esconder uma falha de enfileiramento do operador.
   */
  publicacaoOk?: boolean;
}

export interface CriarKitDeps {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  /** Injetável em teste; produção resolve via resolverConexao + getValidAccessTokenConexao. */
  resolverToken: () => Promise<string>;
  /** Injetável em teste; produção usa lerSchemaAtributos real. */
  lerSchema: (token: string, categoriaId: string) => Promise<AtributoSchema[]>;
  /**
   * Encadeia publicar-familias (server-to-server, JWT do chamador) com os ids das famílias de
   * kit RECÉM-CRIADAS nesta chamada. Só é invocada quando a base já tem `ml_item_id` (caminho
   * Publicados) — ver Step 10 do brief: nunca chame `enfileirarPublicacoes` direto daqui.
   */
  encadearPublicacao: (familiaIds: string[]) => Promise<boolean>;
}

// O que NÃO se copia da base: identidade, lifecycle, rastros de execução e resultado.
export const STRIP_FAMILIA_KIT = [
  'id', 'criado_em', 'atualizado_em', 'lote_id', 'status', 'chave_cadastro',
  'qstash_message_id', 'erro_mensagem', 'editado_em', 'publicado_em', 'titulo_descartes',
  'mudanca_estrutural', 'ml_item_id', 'ml_permalink', 'codigo_pai',
  'titulo_ml', 'descricao_ml', 'atributos_ml',
  'capa_storage_path', 'capa_ml_picture_id', 'capa2_storage_path', 'capa2_ml_picture_id',
  'capa3_storage_path', 'capa3_ml_picture_id',
  'atacado', 'atacado_status', 'atacado_erro',
  'kit_base_codigo_pai', 'kit_multiplicador',
] as const;

export const STRIP_VARIACAO_KIT = [
  'id', 'criado_em', 'atualizado_em', 'familia_id', 'codigo',
  'gtin', 'estoque', 'estoque_anterior', 'ml_variation_id', 'ml_picture_id', 'imagem_path',
  'catalog_product_id', 'catalog_listing_id', 'catalog_status', 'catalog_erro',
  'preco_publicado_ml', 'custo', 'peso_gramas',
  'altura_cm', 'largura_cm', 'comprimento_cm', 'preco', 'preco_publicacao',
  'atacado', 'exibir_com_desconto', 'desconto_pct',
] as const;

function clonarSem(row: Record<string, unknown>, strip: readonly string[]): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!strip.includes(k)) clone[k] = v;
  }
  return clone;
}

/** Clona a família-base (select('*')) removendo STRIP_FAMILIA_KIT e aplicando os campos do kit. */
export function montarFamiliaKit(
  base: Record<string, unknown>,
  kit: KitSolicitado,
  ctx: { loteId: string; codigoPai: string; atributos: AtributoML[] },
): Record<string, unknown> {
  const clone = clonarSem(base, STRIP_FAMILIA_KIT);
  return {
    ...clone,
    lote_id: ctx.loteId,
    codigo_pai: ctx.codigoPai,
    chave_cadastro: kit.chaveCadastro,
    status: 'pronto',
    operacao: 'CREATE',
    nome_pai: kit.titulo,
    titulo_ml: kit.titulo,
    // o operador confirmou no preview (D-4).
    titulo_editado_pelo_operador: true,
    descricao_pai: kit.descricao,
    descricao_ml: kit.descricao,
    descricao_editada_pelo_operador: true,
    atributos_ml: ctx.atributos,
    // pré-preenchida com a da base, trocável (D-4).
    capa_storage_path: kit.imagemPath,
    // foto nova → picture_id é resolvido no CREATE.
    capa_ml_picture_id: null,
    // vazio por padrão, NÃO herda a base (D-4).
    atacado: kit.atacado ?? null,
    atacado_status: null,
    atacado_erro: null,
    kit_base_codigo_pai: base.codigo_pai,
    kit_multiplicador: kit.multiplicador,
  };
}

/** Clona a variação-base (select('*')) removendo STRIP_VARIACAO_KIT e aplicando os campos do kit. */
export function montarVariacaoKit(
  baseVar: Record<string, unknown>,
  kit: KitSolicitado,
  ctx: { familiaId: string; codigo: string },
): Record<string, unknown> {
  const clone = clonarSem(baseVar, STRIP_VARIACAO_KIT);
  return {
    ...clone,
    familia_id: ctx.familiaId,
    codigo: ctx.codigo,
    // null por padrão, NUNCA o da base (D-5).
    gtin: kit.gtin,
    // trigger força; explícito por clareza (D-8).
    estoque: 0,
    estoque_anterior: 0,
    custo: Number((Number(baseVar.custo) * kit.multiplicador).toFixed(2)),
    peso_gramas: Number(baseVar.peso_gramas) * kit.multiplicador,
    altura_cm: kit.alturaCm,
    largura_cm: kit.larguraCm,
    comprimento_cm: kit.comprimentoCm,
    preco: kit.preco,
    preco_publicacao: kit.preco,
    // o operador confirmou no preview.
    preco_editado_pelo_operador: true,
    preco_publicado_ml: null,
    imagem_path: kit.imagemPath,
    ml_picture_id: null,
    ml_variation_id: null,
    catalog_product_id: null,
    catalog_listing_id: null,
    catalog_status: 'pendente',
    catalog_erro: null,
    cor: null,
    cor_hex: null,
    cor_origem: null,
    cor_editada_pelo_operador: false,
    excluida_da_publicacao: false,
    atacado: null,
    exibir_com_desconto: null,
    desconto_pct: null,
  };
}

/**
 * Reserva `qtdKits * 2` números (1 PAI + 1 SKU por kit) e devolve N pares. `derivarCodigos`
 * só devolve UM codigoPai + o resto em `codigos` — aqui a faixa reservada é repartida em pares
 * sequenciais, um por kit, na mesma ordem de `kits`.
 */
function paresDeCodigos(ultimo: number, qtdKits: number): { codigoPai: string; codigo: string }[] {
  const { codigoPai, codigos } = derivarCodigos(ultimo, qtdKits * 2);
  const pares = [{ codigoPai, codigo: codigos[0] }];
  for (let i = 1; i < qtdKits; i++) {
    pares.push({ codigoPai: codigos[2 * i - 1], codigo: codigos[2 * i] });
  }
  return pares;
}

async function reservarCodigos(
  admin: SupabaseClient, orgId: string, qtdKits: number,
): Promise<{ pares: { codigoPai: string; codigo: string }[] } | { erro: string }> {
  const qtd = qtdKits * 2;
  const primeiraReserva = await admin.rpc('proximo_codigo_produto', { p_org: orgId, p_qtd: qtd });
  if (primeiraReserva.error || primeiraReserva.data == null) {
    return { erro: primeiraReserva.error?.message ?? 'sequência indisponível' };
  }
  let pares: { codigoPai: string; codigo: string }[];
  try {
    pares = paresDeCodigos(Number(primeiraReserva.data), qtdKits);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Faixa de códigos inválida.' };
  }
  let usados = await codigosJaUsados(admin, orgId, pares.flatMap((p) => [p.codigoPai, p.codigo]));
  if (usados.length > 0) {
    // Colisão sobre código gerado (D-4.1/D-10): ressincroniza e tenta UMA vez.
    console.warn('criar_kit_vinculado_resync_sequencia', { orgId, usados });
    const reReserva = await admin.rpc('proximo_codigo_produto', { p_org: orgId, p_qtd: qtd, p_resync: true });
    if (reReserva.error || reReserva.data == null) {
      return { erro: reReserva.error?.message ?? 'sequência indisponível' };
    }
    try {
      pares = paresDeCodigos(Number(reReserva.data), qtdKits);
    } catch (e) {
      return { erro: e instanceof Error ? e.message : 'Faixa de códigos inválida.' };
    }
    usados = await codigosJaUsados(admin, orgId, pares.flatMap((p) => [p.codigoPai, p.codigo]));
    if (usados.length > 0) {
      console.error('criar_kit_vinculado_colisao_pos_resync', { orgId, usados });
      return { erro: 'Falha na numeração automática. Tente novamente.' };
    }
  }
  return { pares };
}

export async function criarKitsVinculados(
  deps: CriarKitDeps, input: CriarKitInput,
): Promise<ResultadoCriarKits> {
  const { admin, orgId } = deps;

  // ── Validação de payload por kit (não toca banco) ──────────────────────────────────────
  for (const kit of input.kits) {
    if (!Number.isInteger(kit.multiplicador) || kit.multiplicador < 2 || kit.multiplicador > 6) {
      return { ok: false, motivo: 'multiplicador_invalido' };
    }
  }
  for (const kit of input.kits) {
    if (typeof kit.titulo !== 'string' || kit.titulo.length === 0 || kit.titulo.length > 60) {
      return { ok: false, motivo: 'titulo_longo' };
    }
  }
  for (const kit of input.kits) {
    if (typeof kit.preco !== 'number' || !(kit.preco > 0)) {
      return { ok: false, motivo: 'preco_invalido' };
    }
  }
  const multsDaSubmissao = new Set<number>();
  for (const kit of input.kits) {
    if (multsDaSubmissao.has(kit.multiplicador)) return { ok: false, motivo: 'kit_duplicado' };
    multsDaSubmissao.add(kit.multiplicador);
  }

  // ── Idempotência, por kit (ADR-0096 D-9) ───────────────────────────────────────────────
  // `chave_cadastro` é UMA POR KIT — reenviar a mesma lista de uuids devolve as famílias
  // existentes sem criar nada; um subconjunto novo cria só o que falta.
  const chaves = input.kits.map((k) => k.chaveCadastro);
  const { data: existentesFamilias, error: erroExistentes } = await admin.from('familias')
    .select('id, codigo_pai, kit_multiplicador, chave_cadastro, status')
    .eq('org_id', orgId).in('chave_cadastro', chaves);
  if (erroExistentes) return { ok: false, motivo: 'falha_leitura', mensagem: erroExistentes.message };

  const idsExistentes = (existentesFamilias ?? []).map((f) => f.id as string);
  const { data: variacoesExistentes } = idsExistentes.length > 0
    ? await admin.from('variacoes').select('familia_id, codigo').in('familia_id', idsExistentes)
    : { data: [] as { familia_id: string; codigo: string }[] };
  const codigoPorFamilia = new Map(
    (variacoesExistentes ?? []).map((v) => [v.familia_id as string, v.codigo as string]),
  );

  const kitsExistentes: KitCriado[] = (existentesFamilias ?? []).map((f) => ({
    familiaId: f.id as string,
    codigoPai: f.codigo_pai as string,
    codigo: codigoPorFamilia.get(f.id as string) ?? '',
    multiplicador: Number(f.kit_multiplicador),
  }));
  const chavesExistentes = new Set((existentesFamilias ?? []).map((f) => f.chave_cadastro as string));
  const kitsFaltando = input.kits.filter((k) => !chavesExistentes.has(k.chaveCadastro));

  // ── Ler a base ──────────────────────────────────────────────────────────────────────────
  // Carregada mesmo quando TODOS os kits já existem (kitsFaltando vazio): é o `ml_item_id`
  // dela que decide o encadeamento abaixo, inclusive no reenvio puro (kit existente ainda
  // 'pronto'/'erro' — mesmo padrão de `adicionar-variacoes-familia/index.ts:84-105`, que
  // RE-ENCADEIA em vez de devolver sucesso fabricado quando a família idempotente não
  // terminou de publicar).
  const { data: base } = await admin.from('familias').select('*')
    .eq('id', input.familiaBaseId).eq('org_id', orgId).maybeSingle();
  if (!base) return { ok: false, motivo: 'base_nao_encontrada' };

  const kitsCriados: KitCriado[] = [];

  if (kitsFaltando.length > 0) {
    const { data: variacoesBase } = await admin.from('variacoes')
      .select('*').eq('familia_id', base.id as string);
    if (!variacoesBase || variacoesBase.length === 0) return { ok: false, motivo: 'base_sem_variacao' };
    // Decisão 10 (escopo v1): kit só a partir de produto sem cor.
    if (variacoesBase.length > 1) return { ok: false, motivo: 'base_multivariacao' };
    const baseVar = variacoesBase[0];

    // Kit de kit não existe.
    if (base.kit_multiplicador != null) return { ok: false, motivo: 'base_e_kit' };

    // Custo alimenta markup (ADR-0055): nunca pode nascer 0 nem null.
    const custoBase = baseVar.custo == null ? null : Number(baseVar.custo);
    if (custoBase == null || custoBase <= 0) return { ok: false, motivo: 'base_sem_custo' };

    // Peso alimenta frete (ADR-0018).
    const pesoBase = baseVar.peso_gramas == null ? null : Number(baseVar.peso_gramas);
    if (pesoBase == null || pesoBase <= 0) return { ok: false, motivo: 'base_sem_peso' };

    if (!base.categoria_ml_id) return { ok: false, motivo: 'base_sem_categoria' };

    // Tamanhos não repetidos entre os kits desta submissão E os já vivos da base.
    const kitsVivos = await listarKitsVivos(admin, orgId, base.codigo_pai as string);
    const multsVivos = new Set(kitsVivos.map((k) => k.kit_multiplicador));
    if (kitsFaltando.some((k) => multsVivos.has(k.multiplicador))) {
      return { ok: false, motivo: 'kit_duplicado' };
    }

    // ── Atributos (força SALE_FORMAT=Kit por categoria, uma vez — schema é o mesmo p/ todos) ─
    let schema: AtributoSchema[];
    try {
      const token = await deps.resolverToken();
      schema = await deps.lerSchema(token, base.categoria_ml_id as string);
    } catch (e) {
      return { ok: false, motivo: 'sem_conexao_ml', mensagem: e instanceof Error ? e.message : String(e) };
    }
    const atributosPorMultiplicador = new Map<number, AtributoML[]>();
    for (const kit of kitsFaltando) {
      try {
        atributosPorMultiplicador.set(
          kit.multiplicador,
          aplicarKitNosAtributos(schema, (base.atributos_ml as AtributoML[] | null) ?? [], kit.multiplicador),
        );
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        if (status === 400) {
          return { ok: false, motivo: 'categoria_sem_kit', mensagem: (e as Error).message };
        }
        throw e;
      }
    }

    // ── Códigos (1 PAI + 1 SKU por kit) ──────────────────────────────────────────────────
    const reserva = await reservarCodigos(admin, orgId, kitsFaltando.length);
    if ('erro' in reserva) return { ok: false, motivo: 'falha_numeracao', mensagem: reserva.erro };
    const { pares } = reserva;

    // ── Lote técnico dedicado, nascido em 'publicando' (nunca card de Revisão) ───────────
    const { data: loteNovo, error: loteErr } = await admin.from('lotes')
      .insert({ user_id: deps.userId, org_id: orgId, status: 'publicando', origem: 'manual' })
      .select('id').single();
    if (loteErr || !loteNovo) return { ok: false, motivo: 'falha_lote' };
    const loteId = loteNovo.id as string;
    const { data: numeroOrg } = await admin.rpc('proximo_numero_lote', { p_org: orgId });
    if (numeroOrg != null) await admin.from('lotes').update({ numero_org: numeroOrg }).eq('id', loteId);

    // ── Insere UMA família por kit, cada uma em sua própria chamada de .insert() (nunca um
    //    array misto — é isso que impede o bug de união de chaves do PostgREST, ADR-0129). ──
    let algumKitCriado = false;
    for (const [i, kit] of kitsFaltando.entries()) {
      const par = pares[i];
      const familiaObj = montarFamiliaKit(base as Record<string, unknown>, kit, {
        loteId, codigoPai: par.codigoPai, atributos: atributosPorMultiplicador.get(kit.multiplicador)!,
      });
      const { data: familiaCriada, error: famErr } = await admin.from('familias')
        .insert(familiaObj).select('id').single();
      if (famErr || !familiaCriada) {
        if (!algumKitCriado) await admin.from('lotes').delete().eq('id', loteId);
        return { ok: false, motivo: 'falha_criar_familia', mensagem: famErr?.message };
      }
      const familiaId = familiaCriada.id as string;

      const variacaoObj = montarVariacaoKit(baseVar as Record<string, unknown>, kit, {
        familiaId, codigo: par.codigo,
      });
      const { error: varErr } = await admin.from('variacoes').insert(variacaoObj);
      if (varErr) {
        await admin.from('familias').delete().eq('id', familiaId);
        if (!algumKitCriado) await admin.from('lotes').delete().eq('id', loteId);
        return { ok: false, motivo: 'falha_criar_variacao', mensagem: varErr.message };
      }

      algumKitCriado = true;
      kitsCriados.push({
        familiaId, codigoPai: par.codigoPai, codigo: par.codigo, multiplicador: kit.multiplicador,
      });
    }
  }

  // ── Encadeamento (D-2) ──────────────────────────────────────────────────────────────────
  // Base já publicada (ml_item_id != null, caminho Publicados): encadeia agora — kits recém-
  // criados NESTA chamada e, no reenvio (total ou parcial), kits já existentes que ainda não
  // terminaram de publicar ('pronto'/'erro' — 'publicando'/'publicado' ficam de fora, já em
  // voo ou prontos). Base ainda em Revisão (ml_item_id null): NÃO encadeia — é o CREATE da
  // base que reclama estes kits depois (publish-familia-ml/processar.ts). Nunca chame
  // enfileirarPublicacoes direto: publicar-familias faz o claim atômico status →
  // 'publicando' antes de enfileirar.
  let publicacaoOk = true;
  if (base.ml_item_id != null) {
    const idsPendentesExistentes = (existentesFamilias ?? [])
      .filter((f) => f.status === 'pronto' || f.status === 'erro')
      .map((f) => f.id as string);
    const idsParaEncadear = [...kitsCriados.map((k) => k.familiaId), ...idsPendentesExistentes];
    if (idsParaEncadear.length > 0) {
      publicacaoOk = await deps.encadearPublicacao(idsParaEncadear);
    }
  }

  return { ok: true, kits: [...kitsExistentes, ...kitsCriados], publicacaoOk };
}
