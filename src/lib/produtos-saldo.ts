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
  imagem_path: string | null; ml_picture_id: string | null;
  familias: {
    codigo_pai: string; nome_pai: string; descricao_pai: string | null; criado_em: string;
    capa_storage_path: string | null; capa_ml_picture_id: string | null;
    variacao_principal_codigo: string | null; fornecedor: string | null;
    unidade: string | null; origem: string; ml_item_id: string | null;
  } | null;
}

/**
 * Miniatura pública de uma foto do Mercado Livre. Quase nenhum produto de planilha tem capa no
 * Storage (1 de 147 na org da AVIL em 2026-08-11) — a foto real vive no anúncio, e o que temos
 * aqui é o `ml_picture_id`. `-V` é a variante reduzida (~30 KB); `-O` é a original e pesa o
 * dobro sem ganho nenhum num thumb de 40px.
 */
export function urlFotoMl(pictureId: string | null | undefined): string | null {
  return pictureId ? `https://http2.mlstatic.com/D_${pictureId}-V.jpg` : null;
}

export interface VariacaoComSaldo {
  codigo: string; nome: string | null; cor: string | null; gtin: string | null;
  estoque: number; custo: number | null; preco: number;
  pesoGramas: number | null; alturaCm: number | null; larguraCm: number | null; comprimentoCm: number | null;
  imagemPath: string | null;
  /** Foto no ML. Usada quando a variação não tem imagem no Storage — ver `urlFotoMl`. */
  mlPictureId: string | null;
}

export interface ProdutoComSaldo {
  codigoPai: string;
  nomePai: string;
  descricaoPai: string | null;
  variacoes: VariacaoComSaldo[];
  saldoTotal: number;
  capaStoragePath: string | null;
  /** Capa da família no ML. Fallback quando não há capa no Storage — ver `urlFotoMl`. */
  capaMlPictureId: string | null;
  fornecedor: string | null;
  unidade: string | null;
  origem: string;
  /** Fonte CANÔNICA de "publicado no ML". `anuncios_externos` é espelho best-effort e pode
   *  estar furado (espelhar.ts:117 só loga a falha) — ver §3.4 da spec. */
  mlItemId: string | null;
  criadoEm: string;
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
  const principalPorPai = new Map<string, string>();
  for (const l of linhas) {
    const f = l.familias;
    if (!f?.codigo_pai) continue;
    const pai = f.codigo_pai;
    if (f.criado_em !== maisRecentePorPai.get(pai)) continue;
    if (!porPai.has(pai)) {
      porPai.set(pai, {
        codigoPai: pai, nomePai: f.nome_pai, descricaoPai: f.descricao_pai,
        variacoes: [], saldoTotal: 0,
        capaStoragePath: f.capa_storage_path, capaMlPictureId: f.capa_ml_picture_id,
        fornecedor: f.fornecedor,
        unidade: f.unidade, origem: f.origem, mlItemId: f.ml_item_id,
        criadoEm: f.criado_em,
      });
    }
    const p = porPai.get(pai)!;
    p.variacoes.push({
      codigo: l.codigo, nome: l.nome, cor: l.cor, gtin: l.gtin, estoque: l.estoque, custo: l.custo, preco: l.preco,
      pesoGramas: l.peso_gramas, alturaCm: l.altura_cm, larguraCm: l.largura_cm, comprimentoCm: l.comprimento_cm,
      imagemPath: l.imagem_path, mlPictureId: l.ml_picture_id,
    });
    p.saldoTotal += l.estoque;
    if (f.variacao_principal_codigo) principalPorPai.set(pai, f.variacao_principal_codigo);
  }

  // Capa herdada da variação. Produto de planilha nasce sem capa própria (1 de 147 tinha, na
  // AVIL em 2026-08-11), então o pai adota a foto da variação PRINCIPAL e, na falta dela, a da
  // primeira variação que tiver foto. Resolvido DEPOIS do loop porque a variação principal pode
  // aparecer em qualquer posição. Capa própria da família sempre vence.
  for (const p of porPai.values()) {
    const principal = p.variacoes.find((v) => v.codigo === principalPorPai.get(p.codigoPai));
    p.capaStoragePath ??= principal?.imagemPath
      ?? p.variacoes.find((v) => v.imagemPath)?.imagemPath ?? null;
    p.capaMlPictureId ??= principal?.mlPictureId
      ?? p.variacoes.find((v) => v.mlPictureId)?.mlPictureId ?? null;
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
    .select('codigo, nome, cor, gtin, estoque, custo, preco, peso_gramas, altura_cm, largura_cm, comprimento_cm, imagem_path, ml_picture_id, familias!inner(codigo_pai, nome_pai, descricao_pai, criado_em, capa_storage_path, capa_ml_picture_id, variacao_principal_codigo, fornecedor, unidade, origem, ml_item_id)')
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

export interface ResultadoAjusteItem {
  codigo: string;
  estoque: number | null;
  duplicada: boolean;
  erro?: string;
}

export interface ResultadoAjuste {
  resultados: ResultadoAjusteItem[];
  /** false = saldo gravado, mas a propagação para os marketplaces falhou. NUNCA descartar. */
  pushOk: boolean;
}

/**
 * Reduz ou zera saldo (ADR-0110). Aumentar é Entrada de mercadoria — a edge recusa, porque
 * entrada exige custo e é ele que alimenta markup e preço (ADR-0055).
 */
export async function ajustarEstoque(p: {
  ajustes: { codigo: string; novoSaldo: number }[];
  observacao?: string | null;
  /** uuid gerado UMA vez por submissão — não regenerar no retry, senão reaplica. */
  ref: string;
}): Promise<ResultadoAjuste> {
  const { data, error } = await supabase.functions.invoke('ajustar-estoque', {
    body: { ajustes: p.ajustes, observacao: p.observacao ?? null, ref: p.ref },
  });
  if (error) throw await erroDaEdge(error);
  const r = data as { resultados?: ResultadoAjusteItem[]; pushOk?: boolean };
  return { resultados: r.resultados ?? [], pushOk: r.pushOk !== false };
}

/** Produto já cadastrado: carrega os ids para a tela oferecer "abrir o produto". */
export class ProdutoJaExisteError extends Error {
  constructor(mensagem: string, readonly familiaId: string, readonly loteId: string) {
    super(mensagem);
    this.name = 'ProdutoJaExisteError';
  }
}

/** Resultado indeterminado — nem confirma nem nega a gravação (rede caiu antes da resposta,
 *  ou a edge devolveu um erro que não é 409 nem validação). Quem chama NÃO pode tratar como
 *  resolvido: a chave de idempotência do cadastro precisa sobreviver pro retry (D-9/ADR-0094),
 *  senão um segundo submit gera um segundo produto. */
export class CadastroResultadoAmbiguoError extends Error {}

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
    // Ambíguo: `detalhe === null` é falha de rede (sem resposta HTTP real); `detalhe !== null`
    // aqui é um corpo de erro que não bate com 409 nem validação. Os dois merecem o mesmo
    // tratamento no cliente — ver CadastroResultadoAmbiguoError.
    throw new CadastroResultadoAmbiguoError(String(detalhe?.corpo.error ?? (error as Error).message));
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
