// E6b (ADR-0094, D-3/D-4/D-9): validação e montagem do produto cadastrado à mão.
// Grava exatamente as mesmas colunas que o ingest-lote grava a partir da planilha — o
// downstream (IA, Revisão, publicação) não sabe de onde o produto veio.

export interface VariacaoEntrada {
  codigo: string;
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

export interface ProdutoEntrada {
  codigoPai: string;
  nomePai: string;
  descricaoPai?: string | null;
  unidade?: string | null;
  fornecedor?: string | null;
  origem: 'nacional' | 'importado';
  variacoes: VariacaoEntrada[];
}

export interface ErroValidacao { campo: string; mensagem: string }

const ORIGENS_VALIDAS = ['nacional', 'importado'];

export function validarProdutoNovo(p: ProdutoEntrada): ErroValidacao[] {
  const erros: ErroValidacao[] = [];
  if (!p.codigoPai?.trim()) erros.push({ campo: 'codigoPai', mensagem: 'Código do produto é obrigatório.' });
  if (!p.nomePai?.trim()) erros.push({ campo: 'nomePai', mensagem: 'Nome do produto é obrigatório.' });

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

  const vistos = new Set<string>();
  p.variacoes.forEach((v, i) => {
    const codigo = v.codigo?.trim() ?? '';
    if (!codigo) {
      erros.push({ campo: `variacoes[${i}].codigo`, mensagem: 'Código da variação é obrigatório.' });
    } else if (vistos.has(codigo)) {
      erros.push({ campo: `variacoes[${i}].codigo`, mensagem: `Código ${codigo} repetido neste produto.` });
    } else {
      vistos.add(codigo);
    }

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
  ctx: { loteId: string; userId: string; orgId: string },
): { familia: Record<string, unknown>; variacoes: Array<Record<string, unknown>> } {
  const familia = {
    lote_id: ctx.loteId,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo_pai: p.codigoPai.trim(),
    nome_pai: p.nomePai.trim(),
    descricao_pai: p.descricaoPai?.trim() || null,
    unidade: p.unidade?.trim() || null,
    fornecedor: p.fornecedor?.trim() || null,
    // Sempre explícita: validarProdutoNovo já barrou valor ausente/inválido, então nunca
    // caímos no DEFAULT 'nacional' da coluna sem o operador ter dito.
    origem: p.origem,
    operacao: 'CREATE',
    status: 'pendente',
  };

  const variacoes = p.variacoes.map((v) => ({
    user_id: ctx.userId,
    org_id: ctx.orgId,
    codigo: v.codigo.trim(),
    nome: v.nome?.trim() || null,
    gtin: v.gtin?.trim() || null,
    preco: v.preco,
    custo: v.custo ?? null,
    // Estoque nasce ZERO: o saldo entra por registrar_entrada, caminho único de escrita (D-15).
    estoque: 0,
    peso_gramas: v.pesoGramas ?? null,
    altura_cm: v.alturaCm ?? null,
    largura_cm: v.larguraCm ?? null,
    comprimento_cm: v.comprimentoCm ?? null,
  }));

  return { familia, variacoes };
}
