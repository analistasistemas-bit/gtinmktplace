// ADR-0129 — adicionar variação a família publicada, direto da tela Estoque. Miolo de
// `adicionar-variacoes-familia`: valida o payload e clona `familias`/`variacoes` para o lote de
// UPDATE novo (puro). As únicas funções com I/O são as extraídas para teste com fake
// (`detectarUP`, `carregarContextoGrade`, `aplicarEstoqueInicial`); `index.ts` orquestra o resto.
import type { adminClient } from '../_shared/supabase.ts';
import { tiposProdutoDaOrg } from '../_shared/produto/tipo-produto.ts';
import {
  classificarFamilia, numeracaoPublicavel, tamanhosDoTipo, tipoDaGrade,
} from '../_shared/produto/tipos-produto-valores.ts';

type Admin = ReturnType<typeof adminClient>;

export interface VariacaoNovaEntrada {
  codigo?: string;            // obrigatório SEM tamanho; PROIBIDO com tamanho (gerado pelo sistema)
  nome: string;               // a cor
  tamanho?: string;           // obrigatório em família de grade
  gtin: string | null;
  preco: number; custo: number | null; estoqueInicial: number;
  pesoGramas: number | null; alturaCm: number | null;
  larguraCm: number | null; comprimentoCm: number | null;
  imagemPath?: string;        // foto enviada agora
  fotoDeCodigo?: string;      // OU: herda a foto do SKU vivo com este código (mesma cor) — só em grade
}
/** Entrada com código definitivo (digitado ou gerado) e foto já resolvida. */
export type VariacaoNovaResolvida = Omit<VariacaoNovaEntrada, 'codigo' | 'imagemPath' | 'fotoDeCodigo'> & {
  codigo: string; imagemPath: string | null; mlPictureId: string | null;
};
export interface ErroValidacao { campo: string; mensagem: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normaliza 1-8 dígitos para 8 com padStart; null se não for só-dígitos ou vazio/9+. */
export function normalizarCodigo8(codigo: string): string | null {
  if (typeof codigo !== 'string' || !/^\d{1,8}$/.test(codigo)) return null;
  return codigo.padStart(8, '0');
}

/**
 * Valida o body inteiro (espelha o estilo de `_shared/produto/validar.ts`).
 *
 * `imagemPath` precisa começar com `${userId}/` (é o 1º segmento que a policy do bucket
 * `imagens` exige, ver `_shared/upload`/D-6 do plano) e não conter `..` — sem isto, um path
 * malicioso escreveria fora da pasta do usuário ou fora do bucket.
 */
export function validarEntrada(
  body: { familia_id?: unknown; chave?: unknown; variacoes?: unknown }, userId: string,
): ErroValidacao[] {
  const erros: ErroValidacao[] = [];

  if (typeof body.familia_id !== 'string' || !body.familia_id) {
    erros.push({ campo: 'familia_id', mensagem: 'familia_id é obrigatório.' });
  }
  if (typeof body.chave !== 'string' || !UUID.test(body.chave)) {
    erros.push({ campo: 'chave', mensagem: 'Chave de idempotência ausente ou inválida.' });
  }

  const variacoes = body.variacoes;
  if (!Array.isArray(variacoes) || variacoes.length === 0) {
    erros.push({ campo: 'variacoes', mensagem: 'Informe ao menos uma variação nova.' });
    return erros;
  }

  const codigosVistos = new Map<string, number>();
  variacoes.forEach((raw, i) => {
    const v = raw as Partial<VariacaoNovaEntrada>;
    const prefixo = `variacoes[${i}]`;

    // Com tamanho o código é gerado pelo sistema (`validarGrade` recusa o digitado); sem tamanho
    // continua obrigatório, como sempre. Se veio, o formato é validado nos dois casos.
    if (v.codigo !== undefined || v.tamanho === undefined) {
      const codigoNorm = typeof v.codigo === 'string' ? normalizarCodigo8(v.codigo) : null;
      if (!codigoNorm) {
        erros.push({ campo: `${prefixo}.codigo`, mensagem: 'Código precisa ter de 1 a 8 dígitos.' });
      } else {
        const anterior = codigosVistos.get(codigoNorm);
        if (anterior != null) {
          erros.push({ campo: `${prefixo}.codigo`, mensagem: `Código duplicado no formulário (mesmo de variacoes[${anterior}]).` });
        }
        codigosVistos.set(codigoNorm, i);
      }
    }
    if (v.tamanho !== undefined && (typeof v.tamanho !== 'string' || !v.tamanho.trim())) {
      erros.push({ campo: `${prefixo}.tamanho`, mensagem: 'Tamanho, quando informado, não pode ser vazio.' });
    }

    if (typeof v.nome !== 'string' || !v.nome.trim()) {
      erros.push({ campo: `${prefixo}.nome`, mensagem: 'Nome (cor) é obrigatório.' });
    }
    if (typeof v.preco !== 'number' || v.preco <= 0) {
      erros.push({ campo: `${prefixo}.preco`, mensagem: 'Preço deve ser maior que zero.' });
    }
    if (v.custo != null && (typeof v.custo !== 'number' || v.custo <= 0)) {
      erros.push({ campo: `${prefixo}.custo`, mensagem: 'Custo, quando informado, deve ser maior que zero.' });
    }
    // Desvio 5 do plano: estoqueInicial=0 nasceria excluida_da_publicacao (ADR-0016) — o
    // UPDATE rodaria sem a cor nova, uma submissão inútil.
    if (typeof v.estoqueInicial !== 'number' || !Number.isInteger(v.estoqueInicial) || v.estoqueInicial <= 0) {
      erros.push({ campo: `${prefixo}.estoqueInicial`, mensagem: 'Estoque inicial deve ser um número inteiro maior que zero.' });
    }
    // Exatamente uma origem de foto: enviada agora (`imagemPath`) OU herdada (`fotoDeCodigo`).
    if ((v.imagemPath === undefined) === (v.fotoDeCodigo === undefined)) {
      erros.push({ campo: `${prefixo}.imagemPath`, mensagem: 'Envie a foto ou herde a de um SKU da mesma cor.' });
    } else if (v.imagemPath !== undefined) {
      if (typeof v.imagemPath !== 'string' || !v.imagemPath) {
        erros.push({ campo: `${prefixo}.imagemPath`, mensagem: 'Foto é obrigatória.' });
      } else if (!v.imagemPath.startsWith(`${userId}/`) || v.imagemPath.split('/').includes('..')) {
        erros.push({ campo: `${prefixo}.imagemPath`, mensagem: 'Caminho de foto inválido.' });
      }
    } else if (typeof v.fotoDeCodigo !== 'string' || !normalizarCodigo8(v.fotoDeCodigo)) {
      erros.push({ campo: `${prefixo}.fotoDeCodigo`, mensagem: 'Código do SKU de origem da foto precisa ter de 1 a 8 dígitos.' });
    }
  });

  return erros;
}

/**
 * preco_publicacao da cor nova = menor preco_publicacao não-nulo entre as irmãs INCLUÍDAS
 * (excluida_da_publicacao=false), senão fallback (preço digitado). Mesma regra do ingest-lote
 * (linhas 254-262) — é o que mantém garantirPrecoUniforme feliz no worker Legacy.
 */
export function precoPublicacaoNova(
  irmas: { preco_publicacao: number | null; excluida_da_publicacao: boolean }[],
  fallback: number,
): number {
  const precos = irmas
    .filter((i) => !i.excluida_da_publicacao && i.preco_publicacao != null)
    .map((i) => Number(i.preco_publicacao));
  return precos.length > 0 ? Math.min(...precos) : fallback;
}

// ADR-0166 / R4 → 2026-09-24c: a recusa de família COM tamanho agora vale só para família
// não-UP (`validarGrade`, abaixo): em User Products o SKU novo nasce com SIZE/SIZE_GRID_ROW_ID
// próprios (Task 4). No Legacy a cor nova entraria sem SIZE_GRID_ROW_ID num anúncio que tem — o
// ML recusa o PUT INTEIRO e derruba o estoque junto. `index.ts` decide por `classificarFamilia`
// (que ignora as excluídas); esta função fica como o predicado cru "alguma tem tamanho".
export function familiaTemTamanho(variacoes: Array<{ tamanho: string | null }>): boolean {
  return variacoes.some((v) => v.tamanho?.trim());
}

const chaveGradeEdge = (cor: string, tamanho: string) => `${cor}\u0000${tamanho}`;

/**
 * Regras de grade que dependem da família publicada (as de formato ficam em `validarEntrada`).
 * Na ordem, uma mensagem por variação. "É grade" e o tipo vêm só das INCLUÍDAS; o par
 * duplicado usa TODAS as vivas, inclusive as excluídas (Codex r3 #1). Família simples não lê
 * `ehUP`/`tiposHabilitados`/`genero` — `index.ts` nem os consulta nesse ramo (INV-1).
 */
export function validarGrade(entrada: VariacaoNovaEntrada[], ctx: {
  vivas: Array<{ codigo: string; cor: string | null; tamanho: string | null; excluida_da_publicacao: boolean }>;
  tiposHabilitados: readonly string[]; genero: string | null; ehUP: boolean;
}): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  // Só as INCLUÍDAS definem o que o anúncio é (Codex r3 #1): uma excluída sem tamanho (ou com)
  // não publica e não pode decidir o tipo — mas continua existindo para a checagem de par.
  const incluidas = ctx.vivas.filter((v) => !v.excluida_da_publicacao);
  const classe = classificarFamilia(ctx.vivas);
  if (classe === 'mista') {
    return [{ campo: 'familia_id', mensagem: 'Este produto tem SKUs publicados com e sem tamanho — ajuste pelo suporte antes de adicionar.' }];
  }
  const familiaGrade = classe === 'grade';
  if (familiaGrade && !ctx.ehUP) {
    return [{ campo: 'familia_id', mensagem: 'Este produto usa tamanho mas não está publicado em User Products — adicionar por aqui não é suportado.' }];
  }
  if (familiaGrade && !ctx.genero) {
    return [{ campo: 'familia_id', mensagem: 'Produto de grade sem gênero cadastrado — o Mercado Livre exige gênero junto com a tabela de medidas.' }];
  }
  // O tipo é da FAMÍLIA publicada, não da org (Codex r2 #1): org com roupa e calçado não pode
  // pôr numeração numa jaqueta — o chart de vestuário recusaria DEPOIS de SKU e ledger gravados.
  const tipo = familiaGrade
    ? tipoDaGrade(incluidas.map((v) => (v.tamanho ?? '').trim()))
    : null;
  if (familiaGrade && !tipo) {
    return [{ campo: 'familia_id', mensagem: 'Os tamanhos publicados deste produto não pertencem a um único tipo (roupa ou calçado) — ajuste pelo suporte.' }];
  }
  if (tipo && !ctx.tiposHabilitados.includes(tipo)) {
    return [{ campo: 'familia_id', mensagem: `O tipo ${tipo === 'roupa' ? 'Roupa' : 'Calçado'} está desativado nesta organização — peça ao administrador da plataforma para reativar.` }];
  }
  const tamanhosValidos = tipo ? tamanhosDoTipo(tipo) : [];
  const norm = (s: string | null | undefined) => (s ?? '').trim();
  const pares = new Set(ctx.vivas.map((v) => chaveGradeEdge(norm(v.cor), norm(v.tamanho))));
  entrada.forEach((v, i) => {
    const p = `variacoes[${i}]`;
    const tam = norm(v.tamanho);
    if (!familiaGrade) {
      if (tam) erros.push({ campo: `${p}.tamanho`, mensagem: 'Este produto não usa tamanho.' });
      if (v.fotoDeCodigo) erros.push({ campo: `${p}.imagemPath`, mensagem: 'Envie a foto da cor nova.' });
      return;
    }
    if (!tam) { erros.push({ campo: `${p}.tamanho`, mensagem: 'Tamanho é obrigatório neste produto.' }); return; }
    if (v.codigo !== undefined) { erros.push({ campo: `${p}.codigo`, mensagem: 'Em produto de grade o código é gerado pelo sistema.' }); return; }
    if (!tamanhosValidos.includes(tam)) { erros.push({ campo: `${p}.tamanho`, mensagem: `Tamanho "${tam}" não é válido para este produto.` }); return; }
    if (tipo === 'calcado' && !numeracaoPublicavel(tam, ctx.genero as 'masculino' | 'feminino' | 'unissex')) {
      erros.push({ campo: `${p}.tamanho`, mensagem: `Numeração ${tam} não tem guia de tamanhos no Mercado Livre para este gênero.` }); return;
    }
    const k = chaveGradeEdge(norm(v.nome), tam);
    if (pares.has(k)) { erros.push({ campo: `${p}.tamanho`, mensagem: `${norm(v.nome)} · ${tam} já existe neste produto.` }); return; }
    pares.add(k);
    if (v.fotoDeCodigo) {
      const irma = ctx.vivas.find((x) => x.codigo === normalizarCodigo8(v.fotoDeCodigo!));
      if (!irma || norm(irma.cor) !== norm(v.nome)) {
        erros.push({ campo: `${p}.imagemPath`, mensagem: 'A foto herdada precisa ser de um SKU da mesma cor.' });
      }
    }
  });
  return erros;
}

/** Foto do SKU vivo `fotoDeCodigo` (mesma cor). `ml_picture_id` sozinho basta: o worker UP reusa
 *  o id já subido e só sobe `imagem_path` quando falta (`atualizar-familia-up.ts`). `null` se a
 *  irmã não existe, é de outra cor ou não tem foto nenhuma. */
export function resolverFotoHerdada(
  fotoDeCodigo: string, cor: string,
  vivas: Array<{ codigo: string; cor: string | null; imagem_path: string | null; ml_picture_id: string | null }>,
): { imagemPath: string | null; mlPictureId: string | null } | null {
  const codigo = normalizarCodigo8(fotoDeCodigo);
  const irma = vivas.find((v) => v.codigo === codigo && (v.cor ?? '').trim() === cor.trim());
  if (!irma || (irma.imagem_path == null && irma.ml_picture_id == null)) return null;
  return { imagemPath: irma.imagem_path, mlPictureId: irma.ml_picture_id };
}

/** Todo campo MATERIAL da submissão, normalizado (Codex r3 #2) — o retry compara TUDO, não uma amostra. */
export function normalizarIntencao(v: VariacaoNovaEntrada) {
  return {
    nome: v.nome.trim(), tamanho: v.tamanho?.trim() || null, gtin: v.gtin?.trim() || null,
    preco: v.preco, custo: v.custo ?? null, estoqueInicial: v.estoqueInicial,
    pesoGramas: v.pesoGramas ?? null, alturaCm: v.alturaCm ?? null,
    larguraCm: v.larguraCm ?? null, comprimentoCm: v.comprimentoCm ?? null,
    imagemPath: v.imagemPath ?? null, fotoDeCodigo: v.fotoDeCodigo ? normalizarCodigo8(v.fotoDeCodigo) : null,
    codigoDigitado: v.codigo !== undefined ? normalizarCodigo8(v.codigo) : null,
  };
}
export type IntencaoGravada = ReturnType<typeof normalizarIntencao> & { codigo: string };
export interface ItemEstoqueInicial { codigo: string; qtd: number; custo: number | null }

/**
 * Retry com a mesma `chave` (Codex #3, r2 #2): confere o body contra a intenção GRAVADA na
 * criação em vez de confiar nele. Comparação campo a campo — nunca `JSON.stringify`, porque o
 * jsonb devolve as chaves reordenadas e todo retry legítimo pareceria divergente.
 */
export function decidirRetry(
  intencao: IntencaoGravada[] | null | undefined, body: VariacaoNovaEntrada[], codigosPersistidos: string[],
): { tipo: 'legado' } | { tipo: 'incompleto' } | { tipo: 'divergente' } | { tipo: 'reaplicar'; itens: ItemEstoqueInicial[] } {
  if (!Array.isArray(intencao)) return { tipo: 'legado' };
  const persistidos = new Set(codigosPersistidos);
  if (intencao.filter((it) => persistidos.has(it.codigo)).length < intencao.length) return { tipo: 'incompleto' };
  if (body.length !== intencao.length) return { tipo: 'divergente' };
  const diverge = body.some((b, i) => {
    const gravada = intencao[i] as Record<string, unknown>;
    return Object.entries(normalizarIntencao(b)).some(([k, valor]) => gravada[k] !== valor);
  });
  if (diverge) return { tipo: 'divergente' };
  return { tipo: 'reaplicar', itens: intencao.map((it) => ({ codigo: it.codigo, qtd: it.estoqueInicial, custo: it.custo })) };
}

const CANAL = 'mercado_livre';

/** Família é User Products? MESMA detecção do worker (`update-familia-ml/processar.ts`, roteamento
 *  UP): raiz da partição 0 do produto + linhas filhas DELA — nunca por SKU solto na org (Codex #4).
 *  Fail-closed: erro de consulta lança, nunca vira "não é UP" em silêncio. Família que o worker só
 *  descobriria UP pela adoção (ADR-0104, sem linhas filhas ainda) conta como não-UP aqui e é
 *  recusada — o lado seguro. */
export async function detectarUP(admin: Admin, orgId: string, codigoPai: string): Promise<boolean> {
  const { data: raiz, error: raizErr } = await admin.from('anuncios_externos').select('id')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('canal', CANAL).eq('particao', 0).maybeSingle();
  if (raizErr) throw new Error(`Falha verificando o anúncio: ${raizErr.message}`);
  if (!raiz) return false;
  const { count, error: itErr } = await admin.from('anuncios_externos_itens')
    .select('sku', { count: 'exact', head: true }).eq('anuncio_externo_id', raiz.id as string);
  if (itErr) throw new Error(`Falha verificando o anúncio: ${itErr.message}`);
  return (count ?? 0) > 0;
}

/** Contexto que `validarGrade` precisa. Família simples → NENHUMA consulta (Codex r4 #2): o fluxo
 *  sem tamanho não ganha consulta nem ponto de falha novo (INV-1). Lança em erro de consulta. */
export async function carregarContextoGrade(
  admin: Admin, orgId: string, codigoPai: string,
  vivas: Array<{ tamanho: string | null; excluida_da_publicacao: boolean }>,
): Promise<{ classe: 'simples' | 'grade' | 'mista'; ehUP: boolean; tiposHabilitados: string[] }> {
  const classe = classificarFamilia(vivas);
  if (classe === 'simples') return { classe, ehUP: false, tiposHabilitados: [] };
  const [ehUP, tiposHabilitados] = await Promise.all([
    detectarUP(admin, orgId, codigoPai), tiposProdutoDaOrg(admin, orgId),
  ]);
  return { classe, ehUP, tiposHabilitados };
}

/** Ledger do estoque inicial (mesmo padrão de cadastrar-produto): ref `addvar:{familiaId}:{codigo}`
 *  idempotente pelo índice único de `referencia_externa` — reaplicar no retry é no-op no que já
 *  entrou. Falha NÃO aborta: devolve `'<codigo>: <mensagem>'` por SKU e o operador repõe pela tela. */
export async function aplicarEstoqueInicial(admin: Admin, e: {
  orgId: string; familiaId: string; userId: string; itens: ItemEstoqueInicial[];
}): Promise<string[]> {
  const falhas: string[] = [];
  for (const it of e.itens) {
    const { error } = await admin.rpc('registrar_entrada', {
      p_org: e.orgId, p_codigo: it.codigo, p_qtd: it.qtd,
      p_custo: it.custo ?? null, p_doc: 'Variação adicionada', p_obs: null,
      p_criado_por: e.userId, p_ref: `addvar:${e.familiaId}:${it.codigo}`,
    });
    if (error) falhas.push(`${it.codigo}: ${error.message}`);
  }
  return falhas;
}

// Colunas removidas do clone de `familias` (verificado contra 20260527125643 e as migrations
// posteriores que alteram `familias`, 2026-08-20):
// - id/lote_id/status/chave_cadastro: identidade do lote/família NOVA, nunca da antiga.
// - qstash_message_id/erro_mensagem: estado de fila/erro da tentativa ANTERIOR de publicar a
//   família antiga — a nova ainda não foi enfileirada e não tem erro seu.
// - criado_em/atualizado_em/editado_em/publicado_em: timestamps de processamento da família
//   ANTIGA. atualizado_em tem trigger `moddatetime` só em UPDATE (20260527125643) — sem
//   removê-la aqui, o INSERT gravaria o valor congelado da família antiga em vez do
//   `default now()` da coluna. publicado_em é setado pelo worker só quando A PRÓPRIA família
//   termina de publicar (update-familia-ml/processar.ts:393-396) — igual ao que ingest-lote já
//   faz (não propaga publicado_em pro UPDATE, ingest-lote/index.ts:193-226).
// - titulo_descartes (20260812182613, ADR-0116): diagnóstico da última rodada do pipeline de
//   título da família antiga; a família nova não roda esse pipeline (D-10, sem IA/Revisão) —
//   herdar o valor antigo seria atribuir a ela um diagnóstico que nunca rodou.
// - mudanca_estrutural: snapshot do diff de UM re-ingest específico da família antiga; a família
//   nova recebe o próprio valor (ver index.ts) coerente com as variações desta submissão.
export const STRIP_FAMILIA = [
  'id', 'criado_em', 'atualizado_em', 'lote_id', 'status', 'chave_cadastro',
  'qstash_message_id', 'erro_mensagem', 'editado_em', 'publicado_em',
  'titulo_descartes', 'mudanca_estrutural',
] as const;

/** Clona a linha de familias (select('*')) removendo STRIP_FAMILIA e aplicando overrides. */
export function clonarFamilia(
  row: Record<string, unknown>,
  ctx: { loteId: string; userId: string; chave: string },
): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(STRIP_FAMILIA as readonly string[]).includes(k)) clone[k] = v;
  }
  return {
    ...clone,
    operacao: 'UPDATE',
    status: 'pronto',
    lote_id: ctx.loteId,
    user_id: ctx.userId,
    chave_cadastro: ctx.chave,
  };
}

// `atualizado_em`: mesmo motivo já documentado em STRIP_FAMILIA — o trigger `moddatetime`
// (`variacoes_set_updated_at`, 20260527125643) é `before update`, então num INSERT ele não roda
// e o clone gravaria o timestamp CONGELADO da variação antiga numa linha recém-criada. Faltava
// aqui desde a 1ª versão (2026-08-20); ver o comentário de montarVariacaoNova.
// `exibir_com_desconto`/`desconto_pct`: desconto visual removido por completo (ADR-0162) — as
// colunas ficam órfãs no banco e nenhum builder as toca mais, aqui ou em `montarVariacaoNova`.
export const STRIP_VARIACAO = [
  'id', 'criado_em', 'atualizado_em', 'familia_id', 'exibir_com_desconto', 'desconto_pct',
] as const;

/**
 * Clona linha de variacoes removendo STRIP_VARIACAO e aplicando { familia_id, user_id,
 * estoque: estoqueCanonico ?? row.estoque, estoque_anterior: mesmo valor }. Preserva
 * ml_variation_id/ml_picture_id/cor/preco_publicacao/excluida_da_publicacao.
 */
export function clonarVariacao(
  row: Record<string, unknown>,
  ctx: { familiaId: string; userId: string; estoqueCanonico: number | undefined },
): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(STRIP_VARIACAO as readonly string[]).includes(k)) clone[k] = v;
  }
  const estoque = ctx.estoqueCanonico ?? (row.estoque as number);
  return {
    ...clone,
    familia_id: ctx.familiaId,
    user_id: ctx.userId,
    estoque,
    estoque_anterior: estoque,
  };
}

/**
 * Monta a linha nova: estoque 0 (ledger preenche), excluida_da_publicacao false,
 * cor = nome.trim(), cor_origem 'manual', ml_variation_id/estoque_anterior null, ml_picture_id
 * null salvo foto herdada.
 *
 * INVARIANTE (o bug de 2026-08-21): o conjunto de chaves daqui é IGUAL ao de `clonarVariacao`.
 * `index.ts` insere clones e novas no MESMO array (`insert([...clones, ...novas])`), e o
 * PostgREST resolve um insert multi-row montando a UNIÃO das chaves e preenchendo com NULL
 * as que faltam em cada objeto (`Prefer: missing=null`, default do supabase-js). NULL explícito
 * ATROPELA o DEFAULT da coluna — o DEFAULT só vale quando a coluna está ausente do insert
 * INTEIRO, não de algumas linhas. Como o clone vem de `select('*')`, toda coluna que ele tem e
 * esta função não vira NULL na linha nova; nas NOT NULL isso é 500 garantido
 * (`preco_editado_pelo_operador`, `cor_editada_pelo_operador`, `catalog_status`,
 * `atualizado_em`). Por isso todo campo aparece aqui explicitamente, mesmo quando o valor é
 * null/default — e por isso o teste compara os dois conjuntos de chaves contra o schema real.
 */
export function montarVariacaoNova(
  v: VariacaoNovaResolvida,
  ctx: { familiaId: string; userId: string; orgId: string; precoPublicacao: number },
): Record<string, unknown> {
  return {
    familia_id: ctx.familiaId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo: v.codigo,
    nome: v.nome.trim(),
    gtin: v.gtin,
    preco: v.preco,
    custo: v.custo,
    // Estoque nasce ZERO: o saldo entra pelo ledger (registrar_entrada), caminho único de
    // escrita de estoque (ADR-0094 D-15) — mesmo padrão de cadastrar-produto.
    estoque: 0,
    peso_gramas: v.pesoGramas,
    altura_cm: v.alturaCm,
    largura_cm: v.larguraCm,
    comprimento_cm: v.comprimentoCm,
    imagem_path: v.imagemPath,
    ml_variation_id: null,
    // Foto herdada da irmã da mesma cor traz o id já subido ao ML; foto nova nasce sem id.
    ml_picture_id: v.mlPictureId ?? null,
    estoque_anterior: null,
    cor: v.nome.trim(),
    cor_hex: null,
    cor_origem: 'manual',
    // A cor foi DIGITADA no cadastro, não corrigida depois: quem registra essa procedência é
    // `cor_origem: 'manual'`. A flag marca "operador sobrescreveu uma cor já resolvida" na
    // Revisão (src/lib/queries.ts:391) e nada no pipeline decide por ela — a re-resolução de
    // cor do process-familia é gateada por `if (v.cor) return v` (process-familia/index.ts:138),
    // e esta linha já nasce com `cor` preenchida. false é o valor honesto e inerte.
    cor_editada_pelo_operador: false,
    // ADR-0166 2026-09-24c: tamanho do SKU novo de grade; null em produto sem eixo (INV-1).
    // Continua presente sempre — paridade de chaves com clonarVariacao.
    tamanho: v.tamanho?.trim() || null,
    excluida_da_publicacao: false,
    preco_publicacao: ctx.precoPublicacao,
    // false: `preco_publicacao` acima é DERIVADO das irmãs (precoPublicacaoNova = menor preço
    // das irmãs incluídas), não digitado. Marcar `true` pinaria essa cor contra um repricing
    // futuro que ainda reprecificaria as irmãs (que estão em false) — a família ficaria com
    // preços divergentes e `garantirPrecoUniforme` recusaria a publicação Legacy. O preço veio
    // das irmãs, então precisa seguir as irmãs. Some disso, a flag significa "operador editou
    // `preco_publicacao` inline" (src/lib/queries.ts:328) e o operador digitou `preco`, não
    // `preco_publicacao`. Mesmo resultado do cadastrar-produto, que também não marca a flag.
    preco_editado_pelo_operador: false,
    // SKU novo não tem vínculo de catálogo — 'pendente' é o default da coluna e o único valor
    // coerente com catalog_product_id/listing_id nulos (variacoes_catalog_status_check).
    catalog_product_id: null,
    catalog_listing_id: null,
    catalog_status: 'pendente',
    catalog_erro: null,
    // preco_publicado_ml é observação do que o ML confirmou — a cor ainda não foi publicada.
    preco_publicado_ml: null,
    // null NÃO é "sem atacado": nesta coluna null significa HERDAR o nível família
    // (`resolverConfigGrupo`, _shared/preco/config-grupo.ts — `v.atacado ?? famFaixas`). Copiar o
    // valor explícito de uma irmã é que seria o override, e um override diferente do resto da
    // faixa de preço faz `resolverConfigGrupo` falhar LOUD (400, ADR-0055). Herdando, a cor
    // nova entra com a MESMA config comercial da família, que é o que o operador espera ao
    // adicionar uma cor. Nota: se a irmã da faixa em que a cor nova cai tiver override próprio
    // divergente do família-level, o UPDATE recusa alto com "reconfigure a faixa na Revisão" —
    // comportamento desenhado do ADR-0078 F2, não regressão desta feature.
    atacado: null,
  };
}
