// E6b (ADR-0094): saldo por produto para a tela Estoque, e as chamadas das edges do módulo.
import { supabase } from '@/lib/supabase';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { buildStoragePath, uploadFile } from '@/lib/storage';
import { erroDaEdge, corpoDoErroDaEdge } from '@/lib/edge-erro';
import type { ProdutoEntrada } from '@/lib/produto-entrada';

export interface LinhaVariacaoCrua {
  codigo: string; nome: string | null; cor: string | null; gtin: string | null;
  estoque: number; custo: number | null; preco: number;
  peso_gramas: number | null; altura_cm: number | null; largura_cm: number | null; comprimento_cm: number | null;
  familias: { codigo_pai: string; nome_pai: string; descricao_pai: string | null; criado_em: string } | null;
}

export interface VariacaoComSaldo {
  codigo: string; nome: string | null; cor: string | null; gtin: string | null;
  estoque: number; custo: number | null; preco: number;
  pesoGramas: number | null; alturaCm: number | null; larguraCm: number | null; comprimentoCm: number | null;
}

export interface ProdutoComSaldo {
  codigoPai: string;
  nomePai: string;
  descricaoPai: string | null;
  variacoes: VariacaoComSaldo[];
  saldoTotal: number;
}

export function agruparProdutosComSaldo(linhas: LinhaVariacaoCrua[]): ProdutoComSaldo[] {
  // Só a família MAIS RECENTE de cada codigo_pai é canônica (âncora ADR-0025, a mesma que
  // baixar_estoque e o worker de push usam). Org de planilha tem N lotes do mesmo produto;
  // sem este corte a tela duplicaria variação e somaria saldo histórico.
  const maisRecentePorPai = new Map<string, string>();
  for (const l of linhas) {
    const f = l.familias;
    if (!f?.codigo_pai) continue;
    const atual = maisRecentePorPai.get(f.codigo_pai);
    if (atual === undefined || f.criado_em > atual) {
      maisRecentePorPai.set(f.codigo_pai, f.criado_em);
    }
  }

  const porPai = new Map<string, ProdutoComSaldo>();
  for (const l of linhas) {
    const f = l.familias;
    if (!f?.codigo_pai) continue;
    const pai = f.codigo_pai;
    if (f.criado_em !== maisRecentePorPai.get(pai)) continue;
    if (!porPai.has(pai)) {
      porPai.set(pai, { codigoPai: pai, nomePai: f.nome_pai, descricaoPai: f.descricao_pai, variacoes: [], saldoTotal: 0 });
    }
    const p = porPai.get(pai)!;
    p.variacoes.push({
      codigo: l.codigo, nome: l.nome, cor: l.cor, gtin: l.gtin, estoque: l.estoque, custo: l.custo, preco: l.preco,
      pesoGramas: l.peso_gramas, alturaCm: l.altura_cm, larguraCm: l.largura_cm, comprimentoCm: l.comprimento_cm,
    });
    p.saldoTotal += l.estoque;
  }
  return [...porPai.values()].sort((a, b) => a.nomePai.localeCompare(b.nomePai, 'pt-BR'));
}

/**
 * Produtos com saldo da org. O agrupamento acontece no cliente, sobre um select simples com
 * RLS por org. PAGINAÇÃO OBRIGATÓRIA: o PostgREST trunca em ~1000 linhas, e truncar aqui é
 * pior que uma lista incompleta — o corte "família mais recente" escolheria uma família
 * HISTÓRICA como canônica se a atual caísse fora da página, mostrando saldo errado.
 */
export async function fetchProdutosComSaldo(): Promise<ProdutoComSaldo[]> {
  const data = await buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
    .from('variacoes')
    .select('codigo, nome, cor, gtin, estoque, custo, preco, peso_gramas, altura_cm, largura_cm, comprimento_cm, familias!inner(codigo_pai, nome_pai, descricao_pai, criado_em)')
    .range(de, ate));
  return agruparProdutosComSaldo(data as unknown as LinhaVariacaoCrua[]);
}

export interface ResultadoEntrada {
  estoque: number | null;
  duplicada: boolean;
  /** false = saldo gravado, mas a propagação para os marketplaces falhou. NUNCA descartar. */
  pushOk: boolean;
}

export async function registrarEntrada(p: {
  codigo: string; quantidade: number; custo?: number | null;
  documento?: string | null; observacao?: string | null;
  /** uuid gerado UMA vez por submissão do formulário — não regenerar no retry. */
  ref: string;
}): Promise<ResultadoEntrada> {
  const { data, error } = await supabase.functions.invoke('entrada-estoque', { body: p });
  if (error) throw await erroDaEdge(error);
  const r = data as { estoque: number | null; duplicada?: boolean; pushOk?: boolean };
  return { estoque: r.estoque, duplicada: r.duplicada === true, pushOk: r.pushOk !== false };
}

/** Produto já cadastrado: carrega os ids para a tela oferecer "abrir o produto". */
export class ProdutoJaExisteError extends Error {
  constructor(mensagem: string, readonly familiaId: string, readonly loteId: string) {
    super(mensagem);
    this.name = 'ProdutoJaExisteError';
  }
}

export interface ResultadoCadastro {
  loteId: string;
  familiaId: string;
  /** false = produto gravado, mas o enriquecimento por IA não foi enfileirado. */
  filaOk: boolean;
  falhasEstoque: string[];
  variacoes: Array<{ id: string; codigo: string }>;
}

export async function cadastrarProduto(produto: ProdutoEntrada): Promise<ResultadoCadastro> {
  const { data, error } = await supabase.functions.invoke('cadastrar-produto', { body: produto });
  if (error) {
    // Uma leitura só do corpo (Response.json não pode ser consumido duas vezes).
    const detalhe = await corpoDoErroDaEdge(error);
    if (detalhe?.status === 409 && typeof detalhe.corpo.familiaId === 'string') {
      throw new ProdutoJaExisteError(
        String(detalhe.corpo.error ?? 'Produto já existe.'),
        detalhe.corpo.familiaId as string,
        String(detalhe.corpo.loteId ?? ''),
      );
    }
    const erros = detalhe?.corpo.erros as Array<{ mensagem: string }> | undefined;
    if (erros?.length) throw new Error(erros.map((e) => e.mensagem).join('\n'));
    throw new Error(String(detalhe?.corpo.error ?? (error as Error).message));
  }
  return data as ResultadoCadastro;
}

export type AlvoFoto =
  | { tipo: 'capa' | 'capa2' | 'capa3'; familiaId: string }
  | { tipo: 'variacao'; variacaoId: string };

/**
 * Grava a foto no bucket `imagens` e aponta a coluna certa para ela.
 * O path tem que começar por `auth.uid()` (policy do storage) — é o que `buildStoragePath` monta.
 */
export async function uploadFotoProduto(
  storageOwner: string, loteId: string, arquivo: File, alvo: AlvoFoto,
): Promise<void> {
  // Prefixo único por alvo: com D-1.1 vários produtos vivem no MESMO lote manual e o
  // operador escolhe o nome do arquivo — dois `capa.jpg` colidiriam no mesmo path e um
  // sobrescreveria a foto do outro.
  const idAlvo = alvo.tipo === 'variacao' ? alvo.variacaoId : `${alvo.familiaId}-${alvo.tipo}`;
  const path = buildStoragePath(storageOwner, loteId, `${idAlvo}-${arquivo.name}`);
  await uploadFile('imagens', path, arquivo);

  if (alvo.tipo === 'variacao') {
    const { error } = await supabase.from('variacoes').update({ imagem_path: path }).eq('id', alvo.variacaoId);
    if (error) throw error;
    return;
  }
  // Objeto por ramo em vez de chave dinâmica: o tipo gerado do Supabase rejeita
  // `{ [k: string]: string }` (não prova que a coluna existe).
  const patch = alvo.tipo === 'capa' ? { capa_storage_path: path }
    : alvo.tipo === 'capa2' ? { capa2_storage_path: path }
      : { capa3_storage_path: path };
  const { error } = await supabase.from('familias').update(patch).eq('id', alvo.familiaId);
  if (error) throw error;
}

/** Canais em que cada codigo_pai está publicado. Produto ainda não publicado não aparece no mapa. */
export async function fetchCanaisPorProduto(): Promise<Map<string, string[]>> {
  const data = await buscarTodasPaginas<Record<string, unknown>>((de, ate) => supabase
    .from('anuncios_externos')
    .select('codigo_pai, canal')
    .eq('status', 'publicado')
    .range(de, ate));
  const mapa = new Map<string, string[]>();
  for (const a of data) {
    const pai = a.codigo_pai as string;
    const canal = a.canal as string;
    const atual = mapa.get(pai) ?? [];
    if (!atual.includes(canal)) atual.push(canal);
    mapa.set(pai, atual);
  }
  return mapa;
}
