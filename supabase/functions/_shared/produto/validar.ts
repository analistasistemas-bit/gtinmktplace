// E6b (ADR-0094, D-3/D-4/D-9): validação e montagem do produto cadastrado à mão.
// Grava exatamente as mesmas colunas que o ingest-lote grava a partir da planilha — o
// downstream (IA, Revisão, publicação) não sabe de onde o produto veio.

export interface VariacaoEntrada {
  nome?: string | null;
  /** ADR-0166: tamanho (roupa) ou numeração (calçado). Ausente/null = variação sem esse eixo,
   *  que é o caso de toda org sem tipo de produto habilitado. */
  tamanho?: string | null;
  gtin?: string | null;
  preco: number;
  custo?: number | null;
  estoqueInicial?: number | null;
  pesoGramas?: number | null;
  alturaCm?: number | null;
  larguraCm?: number | null;
  comprimentoCm?: number | null;
}

// ADR-0135: só usado quando a org tem o módulo fiscal habilitado — ver
// cadastrar-produto/processar.ts (validarFiscalDaEntrada).
export interface FiscalEntrada {
  ncm: string;
  cest?: string | null;
  origemNfe: number;
  fci?: string | null;
  exTipi?: string | null;
  tributacaoIcms: string;
}

export interface ProdutoEntrada {
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  /** ADR-0166: gênero da peça. Ausente/null = não informado. O ML exige que o gênero do anúncio
   *  bata com o da tabela de medidas, então valor inválido FALHA em vez de virar default. */
  genero?: 'masculino' | 'feminino' | 'unissex' | null;
  // Idempotência da submissão (spec 2026-07-31, D-9). Sem ela um retry criaria um segundo
  // produto: o código é gerado, então os guards de duplicata NÃO pegam a repetição.
  chaveCadastro: string;
  variacoes: VariacaoEntrada[];
  fiscal?: FiscalEntrada;
}

export interface ErroValidacao { campo: string; mensagem: string }

const ORIGENS_VALIDAS = ['nacional', 'importado'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarProdutoNovo(p: ProdutoEntrada): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  if (!p.nomePai?.trim()) erros.push({ campo: 'nomePai', mensagem: 'Nome do produto é obrigatório.' });

  // Trava LOUD da idempotência: sem chave válida o retry duplica produto e duplica o estoque
  // inicial. "Edge Functions idempotentes" é regra inegociável do projeto — não trocar por um
  // default gerado aqui dentro, que mudaria a cada tentativa e não travaria nada.
  if (!UUID.test(p.chaveCadastro ?? '')) {
    erros.push({ campo: 'chaveCadastro', mensagem: 'Chave de idempotência ausente ou inválida.' });
  }

  // TRAVA LOUD DO IMPOSTO POR ORIGEM (ADR-0055). `familias.origem` é NOT NULL com DEFAULT
  // 'nacional': omitir o campo gravaria o produto como nacional em silêncio e aplicaria a
  // alíquota errada. É o mesmo risco do incidente de 2026-07-14 no ingest-lote — por isso
  // aqui falha em vez de assumir. Nunca troque isto por um default.
  if (!ORIGENS_VALIDAS.includes(p.origem)) {
    erros.push({
      campo: 'origem',
      mensagem: 'Informe a origem do produto (nacional ou importado) — ela define a alíquota de imposto.',
    });
  }

  // ADR-0166. Ausente é válido (org sem tipo habilitado). Presente e fora da lista FALHA: o ML
  // recusa a publicação inteira quando o gênero do anúncio não bate com o da tabela de medidas,
  // e "corrigir para unissex" seria afirmar sobre o produto um dado que ninguém informou.
  const GENEROS_VALIDOS = ['masculino', 'feminino', 'unissex'];
  if (p.genero != null && !GENEROS_VALIDOS.includes(p.genero)) {
    erros.push({
      campo: 'genero',
      mensagem: 'Gênero inválido — use masculino, feminino ou unissex.',
    });
  }

  // R3 (revisão do Fable): gênero é OBRIGATÓRIO quando alguma variação tem tamanho. O ML exige
  // que o gênero do anúncio bata com o da tabela de medidas (ADR-0167) — sem ele a publicação
  // falha LOUD e, antes desta trava, não havia tela nenhuma para informar o dado depois: o
  // produto nascia impublicável. A recusa acontece aqui, no cadastro, que é onde o operador
  // ainda está com a tela aberta e consegue corrigir.
  //
  // INV-1 intacto por construção: `entradaTamanhoEfetiva` (Task 16) roda ANTES deste validador
  // e zera `tamanho` de org sem tipo de produto habilitado, então esta regra nunca é alcançada
  // por quem não contratou o eixo — nem por um payload forjado.
  if (p.variacoes?.some((v) => v.tamanho?.trim())) {
    if (!p.genero) {
      erros.push({
        campo: 'genero',
        mensagem: 'Informe o gênero (masculino, feminino ou unissex) — ele é obrigatório para '
          + 'produto com tamanho/numeração e define a tabela de medidas usada na publicação.',
      });
    }
  }

  if (!p.variacoes || p.variacoes.length === 0) {
    erros.push({ campo: 'variacoes', mensagem: 'Cadastre ao menos uma variação.' });
    return erros;
  }

  p.variacoes.forEach((v, i) => {
    if (v.preco == null || v.preco <= 0) {
      erros.push({ campo: `variacoes[${i}].preco`, mensagem: 'Preço deve ser maior que zero.' });
    }
    // Custo alimenta markup e preço (ADR-0055): valor inválido FALHA, nunca vira default.
    if (v.custo != null && v.custo <= 0) {
      erros.push({ campo: `variacoes[${i}].custo`, mensagem: 'Custo, quando informado, deve ser maior que zero.' });
    }
    if (v.estoqueInicial != null && v.estoqueInicial < 0) {
      erros.push({ campo: `variacoes[${i}].estoqueInicial`, mensagem: 'Estoque inicial não pode ser negativo.' });
    }
  });

  // ADR-0166: com dois eixos, o par (cor, tamanho) é a identidade do SKU. Duas linhas com o mesmo
  // par são dois SKUs indistinguíveis — o ML recusa a variação duplicada e, pior, o casamento
  // POSICIONAL de foto e de estoque inicial (cadastrar-produto/index.ts) passaria a depender de
  // qual das duas o operador quis. Sem tamanho em nenhuma das duas, nada muda: cores repetidas
  // sem tamanho continuam aceitas, como sempre foram.
  const vistos = new Set<string>();
  for (const v of p.variacoes) {
    const cor = v.nome?.trim() || '';
    const tam = v.tamanho?.trim() || '';
    if (!tam) continue;
    const chave = `${cor}\u0000${tam}`;
    if (vistos.has(chave)) {
      erros.push({
        campo: 'variacoes',
        mensagem: `Variação repetida: ${cor || '(sem cor)'} / ${tam}. Cada combinação de cor e tamanho pode aparecer uma vez só.`,
      });
      break;
    }
    vistos.add(chave);
  }

  return erros;
}

export function montarLinhasProduto(
  p: ProdutoEntrada,
  ctx: {
    loteId: string; userId: string; orgId: string;
    codigoPai: string; codigos: string[]; chaveCadastro: string;
    regimeOrg?: 'simples' | 'normal';
  },
): { familia: Record<string, unknown>; variacoes: Array<Record<string, unknown>> } {
  const familia = {
    lote_id: ctx.loteId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo_pai: ctx.codigoPai,
    chave_cadastro: ctx.chaveCadastro,
    nome_pai: p.nomePai.trim(),
    descricao_pai: p.descricaoPai?.trim() || null,
    unidade: p.unidade?.trim() || null,
    fornecedor: p.fornecedor?.trim() || null,
    // Sempre explícita: validarProdutoNovo já barrou valor ausente/inválido, então nunca
    // caímos no DEFAULT 'nacional' da coluna sem o operador ter dito.
    origem: p.origem,
    // ADR-0166: explícito, e null quando não informado — a coluna é nullable sem default e null
    // é o estado de toda família de org sem tipo de produto habilitado.
    genero: p.genero ?? null,
    operacao: 'CREATE',
    status: 'pendente',
    // ADR-0135 D-4: colunas fiscais só quando a entrada trouxe fiscal (org com módulo).
    // O regime que gerou o valor fica gravado junto (detecção de troca de regime, D-6).
    ...(p.fiscal ? {
      ncm: p.fiscal.ncm,
      cest: p.fiscal.cest?.trim() || null,
      origem_nfe: p.fiscal.origemNfe,
      fci: p.fiscal.fci?.trim() || null,
      ex_tipi: p.fiscal.exTipi?.trim() || null,
      tributacao_icms: p.fiscal.tributacaoIcms,
      tributacao_icms_regime: ctx.regimeOrg ?? 'simples',
    } : {}),
  };

  const variacoes = p.variacoes.map((v, i) => {
    const nome = v.nome?.trim() || null;
    return {
      user_id: ctx.userId,
      org_id: ctx.orgId,
      codigo: ctx.codigos[i],
      nome,
      // Operador digitou "Cor / nome" no cadastro manual → grava direto como cor, com
      // cor_origem 'manual' (ADR-0004). Sem isso o process-familia tenta adivinhar a cor a
      // partir do nome (dicionário não cobre "Invisível"/"Incolor"/"Transparente") e não dá
      // para contar com o Vision — a foto só chega na etapa 2, DEPOIS do enfileiramento
      // (ADR-0094): é uma corrida entre a latência do QStash e o upload, não impossibilidade.
      // Vazio mantém cor null: a IA resolve normalmente (process-familia respeita `if (v.cor)`).
      // `cor: null` explícito é redundante hoje (INSERT puro, único caller — ver
      // cadastrar-produto/index.ts) mas fica assim de propósito, igual a nome/gtin abaixo:
      // se este caminho um dia virar upsert, null aqui apagaria uma cor já resolvida pela
      // Vision — melhor um lembrete visível do que um `cor` ausente que passa despercebido.
      ...(nome ? { cor: nome, cor_origem: 'manual' } : { cor: null }),
      gtin: v.gtin?.trim() || null,
      // ADR-0166: tamanho (roupa) / numeração (calçado). Mesma normalização de nome/gtin —
      // `trim() || null` — para nunca gravar string vazia, que viraria um valor de atributo
      // vazio no payload do ML.
      tamanho: v.tamanho?.trim() || null,
      // Cru, sem arredondar aqui: o Postgres parseia o texto decimal do JSON (não multiplica
      // float) e arredonda para numeric(12,2) na escrita — concorda com o que o guard de retry
      // idempotente (`variacoesDivergem`, cadastrar-produto/processar.ts) calcula via
      // `centavosExatos`, que também lê o texto decimal do número, não `preco * 100`. Ver o teste
      // "preço com empate de arredondamento" em cadastrar-produto/__tests__/processar.test.ts —
      // NÃO reintroduzir arredondamento aqui, um `?? 0`/`!` sobre valor inválido grava R$ 0,00 em
      // silêncio (achado de revisão, Task 4b fix round 1).
      preco: v.preco,
      custo: v.custo ?? null,
      // Estoque nasce ZERO: o saldo entra por registrar_entrada, caminho único de escrita (D-15).
      estoque: 0,
      peso_gramas: v.pesoGramas ?? null,
      altura_cm: v.alturaCm ?? null,
      largura_cm: v.larguraCm ?? null,
      comprimento_cm: v.comprimentoCm ?? null,
    };
  });

  return { familia, variacoes };
}
