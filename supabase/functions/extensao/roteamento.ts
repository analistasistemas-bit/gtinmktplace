// Lógica pura da edge `extensao` (ADR-0189 D-17/D-18/D-19): validação do pedido, chaves de
// limite, formas de GTIN e mapeamento das linhas do banco. Sem `jsr:` — testável no vitest.
import type { EntradaAnuncio } from '../_shared/extensao/analisar-anuncio.ts';
import type { VariacaoCusto } from '../_shared/extensao/vinculo.ts';
import { dimensoesValidas } from '../_shared/ml/pacote.ts';

export type TipoPagina = 'anuncio' | 'busca' | 'catalogo';
export interface ChaveVinculo { tipo: 'catalogo' | 'item'; valor: string }

export type Pedido =
  | { acao: 'analisar_anuncio'; tipoPagina: TipoPagina; entrada: EntradaAnuncio }
  | { acao: 'buscar_sku'; termo: string }
  | { acao: 'salvar_vinculo'; chave: ChaveVinculo; variacaoId: string }
  | { acao: 'remover_vinculo'; chave: ChaveVinculo }
  | { acao: 'erro_leitura'; tipoPagina: TipoPagina; mlItemId: string | null; versao: string; motivo: string };

const MLB = /^MLB\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_PAGINA = new Set(['anuncio', 'busca', 'catalogo']);
const MOTIVO = /^(estado_nao_encontrado|campo_ausente:[a-z_]{1,40})$/;

const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const mlb = (v: unknown): v is string => typeof v === 'string' && MLB.test(v);
const tipoPagina = (v: unknown): v is TipoPagina => typeof v === 'string' && TIPOS_PAGINA.has(v);

function chave(v: unknown): ChaveVinculo | null {
  const c = v as { tipo?: unknown; valor?: unknown } | null;
  if (!c || typeof c !== 'object') return null;
  if ((c.tipo !== 'catalogo' && c.tipo !== 'item') || !mlb(c.valor)) return null;
  return { tipo: c.tipo, valor: c.valor };
}

/** Escrita (vínculo) exige escopo `full` em sessão de suporte. */
export function acessoDaAcao(acao: unknown): 'read' | 'write' {
  return acao === 'salvar_vinculo' || acao === 'remover_vinculo' ? 'write' : 'read';
}

/** Pedido validado, ou null (→ `payload_invalido`). */
export function validarPedido(body: unknown): Pedido | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  switch (b.acao) {
    case 'analisar_anuncio': {
      const { mlItemId, sellerId, catalogProductId, categoriaId, preco, eanDaBusca } = b;
      if (!tipoPagina(b.tipoPagina) || !mlb(mlItemId) || !texto(sellerId, 32) || !mlb(categoriaId)) return null;
      if (typeof preco !== 'number' || !Number.isFinite(preco) || preco <= 0) return null;
      if (catalogProductId != null && !mlb(catalogProductId)) return null;
      if (eanDaBusca != null && !texto(eanDaBusca, 20)) return null;
      return {
        acao: 'analisar_anuncio',
        tipoPagina: b.tipoPagina,
        entrada: {
          mlItemId, sellerId, categoriaId, preco,
          catalogProductId: (catalogProductId as string | null | undefined) ?? null,
          eanDaBusca: (eanDaBusca as string | null | undefined) ?? null,
        },
      };
    }
    case 'buscar_sku': {
      const termo = typeof b.termo === 'string' ? b.termo.trim() : '';
      return termo.length >= 2 && termo.length <= 60 ? { acao: 'buscar_sku', termo } : null;
    }
    case 'salvar_vinculo': {
      const c = chave(b.chave);
      if (!c || typeof b.variacaoId !== 'string' || !UUID.test(b.variacaoId)) return null;
      return { acao: 'salvar_vinculo', chave: c, variacaoId: b.variacaoId };
    }
    case 'remover_vinculo': {
      const c = chave(b.chave);
      return c ? { acao: 'remover_vinculo', chave: c } : null;
    }
    case 'erro_leitura': {
      const { versao, motivo, mlItemId } = b;
      if (!tipoPagina(b.tipoPagina) || typeof versao !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao)) return null;
      if (typeof motivo !== 'string' || !MOTIVO.test(motivo)) return null;
      if (mlItemId != null && !mlb(mlItemId)) return null;
      return { acao: 'erro_leitura', tipoPagina: b.tipoPagina, versao, motivo, mlItemId: (mlItemId as string | null | undefined) ?? null };
    }
    default:
      return null;
  }
}

function utc(agora: Date, comMinuto: boolean): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${agora.getUTCFullYear()}${p(agora.getUTCMonth() + 1)}${p(agora.getUTCDate())}${p(agora.getUTCHours())}`;
  return comMinuto ? base + p(agora.getUTCMinutes()) : base;
}

/** Janela fixa de 1 min (30 análises/min por usuário, D-18). */
export const chaveLimite = (userId: string, agora: Date) => `ext:rl:${userId}:${utc(agora, true)}`;
/** Janela fixa de 1 h (20 erros de leitura/h por usuário). */
export const chaveLimiteErro = (userId: string, agora: Date) => `ext:rl-erro:${userId}:${utc(agora, false)}`;

/** Formas equivalentes de um GTIN (zeros à esquerda até 14): o 14 dígitos `0789…` casa com o `789…` gravado. */
export function formasGtin(gtin: string): string[] {
  const nucleo = gtin.replace(/^0+/, '');
  if (!/^\d+$/.test(gtin) || nucleo === '') return [gtin];
  const formas = new Set([gtin]);
  for (const n of [8, 12, 13, 14]) if (n >= nucleo.length) formas.add(nucleo.padStart(n, '0'));
  return [...formas];
}

/** Escapa curingas de LIKE (`%`, `_`, `\`) para busca literal. */
export const escaparLike = (t: string) => t.replace(/[\\%_]/g, '\\$&');

/** UNITS_PER_PACK de /products/{id}; inteiro ≥ 1, senão 1. */
export function unidadesDoProduto(produto: unknown): number {
  const attrs = (produto as { attributes?: Array<{ id?: string; value_name?: string | null }> } | null)?.attributes;
  const v = Number(attrs?.find((a) => a.id === 'UNITS_PER_PACK')?.value_name);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Colunas lidas de `variacoes` (+ família) para montar o custo do vínculo. */
export const SELECT_VARIACAO =
  'id, codigo, nome, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm, atualizado_em, familias!inner(origem, kit_multiplicador, nome_pai)';

export interface LinhaVariacao {
  id: string;
  codigo: string;
  nome: string | null;
  custo: number | string | null;
  peso_gramas: number | string | null;
  altura_cm: number | string | null;
  largura_cm: number | string | null;
  comprimento_cm: number | string | null;
  atualizado_em: string;
  familias: { origem: string | null; kit_multiplicador: number | null; nome_pai: string | null }
    | { origem: string | null; kit_multiplicador: number | null; nome_pai: string | null }[]
    | null;
}

const familia = (l: LinhaVariacao) => (Array.isArray(l.familias) ? l.familias[0] : l.familias) ?? null;
const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const custoDe = (l: LinhaVariacao) => { const c = num(l.custo); return c != null && c > 0 ? c : null; };
const unidadesDe = (l: LinhaVariacao) => Number(familia(l)?.kit_multiplicador ?? 1);

/** O mesmo SKU reaparece em vários lotes (UPDATE): uma linha por código+unidades, preferindo a
 *  que tem custo e, empatado, a mais recente (mesma régua de promocoes/cadastro.ts). */
export function deduplicarPorCodigo(linhas: LinhaVariacao[]): LinhaVariacao[] {
  const m = new Map<string, LinhaVariacao>();
  for (const l of linhas) {
    const k = `${l.codigo}|${unidadesDe(l)}`;
    const atual = m.get(k);
    const vence = !atual
      || (custoDe(l) != null && custoDe(atual) == null)
      || ((custoDe(l) != null) === (custoDe(atual) != null) && l.atualizado_em > atual.atualizado_em);
    if (vence) m.set(k, l);
  }
  return [...m.values()];
}

/** Linha → VariacaoCusto; null se a família não tem origem válida. */
export function variacaoCusto(l: LinhaVariacao): VariacaoCusto | null {
  const origem = familia(l)?.origem;
  if (origem !== 'nacional' && origem !== 'importado') return null;
  const dim = { altura_cm: num(l.altura_cm), largura_cm: num(l.largura_cm), comprimento_cm: num(l.comprimento_cm), peso_gramas: num(l.peso_gramas) };
  return {
    variacaoId: l.id,
    codigo: l.codigo,
    custo: custoDe(l),
    origem,
    unidades: unidadesDe(l),
    dimensoes: dimensoesValidas(dim) ? dim : null,
  };
}

export const variacoesDasLinhas = (linhas: LinhaVariacao[]) =>
  deduplicarPorCodigo(linhas).map(variacaoCusto).filter((v): v is VariacaoCusto => v != null);

/** Item da busca de SKU para o painel. */
export function itemBusca(l: LinhaVariacao) {
  const o = familia(l)?.origem;
  return {
    variacaoId: l.id,
    codigo: l.codigo,
    nome: l.nome ?? familia(l)?.nome_pai ?? null,
    custo: custoDe(l),
    origem: o === 'nacional' || o === 'importado' ? o : null,
  };
}
