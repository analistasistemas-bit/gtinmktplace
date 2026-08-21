// ADR-0129 — adicionar variação a família publicada, direto da tela Estoque. Miolo puro (sem
// I/O) de `adicionar-variacoes-familia`: valida o payload e clona `familias`/`variacoes` para o
// lote de UPDATE novo. `index.ts` orquestra as queries/inserts em cima destas funções.

export interface VariacaoNovaEntrada {
  codigo: string; nome: string; gtin: string | null;
  preco: number; custo: number | null; estoqueInicial: number;
  pesoGramas: number | null; alturaCm: number | null;
  larguraCm: number | null; comprimentoCm: number | null;
  imagemPath: string;
}
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
    if (typeof v.imagemPath !== 'string' || !v.imagemPath) {
      erros.push({ campo: `${prefixo}.imagemPath`, mensagem: 'Foto é obrigatória.' });
    } else if (!v.imagemPath.startsWith(`${userId}/`) || v.imagemPath.split('/').includes('..')) {
      erros.push({ campo: `${prefixo}.imagemPath`, mensagem: 'Caminho de foto inválido.' });
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
export const STRIP_VARIACAO = ['id', 'criado_em', 'atualizado_em', 'familia_id'] as const;

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
 * cor = nome.trim(), cor_origem 'manual', ml_variation_id/ml_picture_id/estoque_anterior null.
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
  v: VariacaoNovaEntrada,
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
    ml_picture_id: null,
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
    // Desconto/atacado NÃO são herdados das irmãs de propósito: são configuração comercial por
    // variação (ADR-0055/preço por variação) e este fluxo não roda nenhuma decisão de preço
    // (D-10, sem IA e sem Revisão). Herdar aplicaria um desconto que ninguém pediu para esta
    // cor; o operador configura pela tela de preços depois, como em qualquer variação nova.
    exibir_com_desconto: null,
    desconto_pct: null,
    atacado: null,
  };
}
