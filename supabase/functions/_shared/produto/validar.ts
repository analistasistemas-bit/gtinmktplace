// E6b (ADR-0094, D-3/D-4/D-9): validação e montagem do produto cadastrado à mão.
// Grava exatamente as mesmas colunas que o ingest-lote grava a partir da planilha — o
// downstream (IA, Revisão, publicação) não sabe de onde o produto veio.

export interface VariacaoEntrada {
  nome?: string | null;
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
