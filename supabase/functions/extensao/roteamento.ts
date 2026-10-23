// Lógica pura da edge `extensao` (ADR-0189 D-17/D-18/D-19): validação do pedido, chaves de
// limite, formas de GTIN e mapeamento das linhas do banco. `jsr:` só como tipo — testável no vitest.
import type { EntradaAnuncio } from '../_shared/extensao/analisar-anuncio.ts';
import type { ComissaoML, Disponivel, VendedorML } from '../_shared/extensao/tipos.ts';
import type { PerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { comissaoDeComProveniencia } from '../_shared/ml/listing-prices.ts';
import type { ListingPriceML } from '../_shared/ml/tarifa.ts';
import type { VariacaoCusto } from '../_shared/extensao/vinculo.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { dimensoesValidas, type DimensoesPacote } from '../_shared/ml/pacote.ts';
import { listarKitsVivos } from '../_shared/estoque/kit.ts';

export type TipoPagina = 'anuncio' | 'busca' | 'catalogo';
export interface ChaveVinculo { tipo: 'catalogo' | 'item'; valor: string }

export type Pedido =
  | { acao: 'analisar_anuncio'; tipoPagina: TipoPagina; entrada: EntradaAnuncio }
  | { acao: 'buscar_sku'; termo: string }
  | { acao: 'salvar_vinculo'; chave: ChaveVinculo; variacaoId: string }
  | { acao: 'remover_vinculo'; chave: ChaveVinculo }
  | { acao: 'erro_leitura'; tipoPagina: TipoPagina; mlItemId: string | null; versao: string; motivo: string }
  | { acao: 'catalogo'; catalogProductId: string; itemDaPagina: string | null }
  | { acao: 'analisar_busca'; eanDaBusca: string | null; itens: ItemBusca[] };

/** Card da busca enviado pelo content script (Task 21). */
export interface ItemBusca { itemId: string; catalogProductId: string | null; preco: number }
export const MAX_ITENS_BUSCA = 50;

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
    case 'catalogo': {
      if (!mlb(b.catalogProductId) || (b.itemDaPagina != null && !mlb(b.itemDaPagina))) return null;
      return { acao: 'catalogo', catalogProductId: b.catalogProductId, itemDaPagina: (b.itemDaPagina as string | null | undefined) ?? null };
    }
    case 'analisar_busca': {
      const { itens, eanDaBusca } = b;
      if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS_BUSCA) return null;
      if (eanDaBusca != null && !texto(eanDaBusca, 20)) return null; // mesmo critério do analisar_anuncio (gtinOuNull decide)
      const vistos = new Set<string>();
      const lidos: ItemBusca[] = [];
      for (const i of itens as Record<string, unknown>[]) {
        if (!i || typeof i !== 'object' || !mlb(i.itemId) || (i.catalogProductId != null && !mlb(i.catalogProductId))) return null;
        if (typeof i.preco !== 'number' || !Number.isFinite(i.preco) || i.preco <= 0) return null;
        if (vistos.has(i.itemId)) continue; // dedupe preservando a ordem da busca
        vistos.add(i.itemId);
        lidos.push({ itemId: i.itemId, catalogProductId: (i.catalogProductId as string | null | undefined) ?? null, preco: i.preco });
      }
      return { acao: 'analisar_busca', eanDaBusca: (eanDaBusca as string | null | undefined) ?? null, itens: lidos };
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

/** Cache de frete por conta ML (o frete é cotado para o vendedor conectado; reconectar outra conta na mesma
 *  org não reaproveita o valor da anterior) + org. */
export const chaveFrete = (conta: string, orgId: string, categoriaId: string, preco: number, dim: DimensoesPacote | null) =>
  `ext:fr:${conta}:${orgId}:${categoriaId}:${preco}:${dim ? `${dim.altura_cm}x${dim.largura_cm}x${dim.comprimento_cm},${dim.peso_gramas}` : 'padrao'}`;

/** Cache do painel de catálogo (60 s): por org e conta ML, porque "Sua" e a participação dependem da conta. */
export const chaveCatalogo = (orgId: string, conta: string, cpid: string, itemDaPagina: string | null) =>
  `ext:catalogo:v1:${orgId}:${conta}:${cpid}:${itemDaPagina ?? '-'}`;

/** Cache de listing_prices por conta ML: a consulta leva o token da org (tarifa pode ser da conta). */
export const chaveComissao = (conta: string, categoriaId: string, tipo: string, preco: number) =>
  `ext:lp:${conta}:${categoriaId}:${tipo}:${preco}`;

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

/** listing_prices → comissão. Sem `sale_fee_details` válido: indisponível. `sale_fee_amount` só entra se for
 *  número finito (null viraria comissão zero); ausente, a margem calcula pelo percentual + fixa. */
export function comissaoDaListingPrice(lp: ListingPriceML, preco: number): Disponivel<ComissaoML> {
  const c = comissaoDeComProveniencia(lp);
  if (c.proveniencia !== 'official') return { estado: 'indisponivel', motivo: c.motivo ?? 'comissão não detalhada pelo Mercado Livre' };
  const fee = lp?.sale_fee_amount;
  return typeof fee === 'number' && Number.isFinite(fee)
    ? { estado: 'ok', valor: { ...c.valor, saleFeeAmount: fee, precoConsultado: preco } }
    : { estado: 'ok', valor: c.valor };
}

/** UNITS_PER_PACK numa lista de atributos do ML: undefined = ausente; null = ilegível (não inteiro ≥ 1). */
function lerUnitsPerPack(attrs: unknown): number | null | undefined {
  type Attr = { id?: string; value_name?: string | null; value_struct?: { number?: unknown } | null };
  const a = Array.isArray(attrs) ? (attrs as Attr[]).find((x) => x?.id === 'UNITS_PER_PACK') : undefined;
  if (!a) return undefined;
  const bruto = a.value_struct?.number ?? a.value_name;
  const v = bruto == null || bruto === '' ? NaN : Number(bruto);
  return Number.isInteger(v) && v >= 1 ? v : null;
}

export const QTD_NAO_CONFIRMADA = 'quantidade por anúncio não confirmada';

/** `date_created` de /products/{id} (corpo do mlGet; null = HTTP/timeout), só se for data válida. */
export function dataDoProduto(produto: unknown): string | null {
  const d = (produto as { date_created?: unknown } | null)?.date_created;
  return typeof d === 'string' && Number.isFinite(new Date(d).getTime()) ? d : null;
}

/** Perfil de /users → vendedor do painel. Período só em dias ("365 days"); o ML manda "historic" para o que é
 *  janela móvel de ~365 dias (ADR-0142, errata) → null, o painel usa rótulo neutro. */
export function vendedorDoPerfil(p: PerfilVendedor): VendedorML {
  const dias = /^(\d{1,4})\s*days?$/i.exec(p.detalhe.transactions.period?.trim() ?? '')?.[1];
  return {
    nickname: p.nickname, nivel: p.nivel, medalha: p.power_seller, vendas: p.transactions_total,
    periodo: dias ? `últimos ${dias} dias` : null, uf: p.uf,
  };
}

/** UNITS_PER_PACK de /products/{id} (corpo do mlGet; null = HTTP/timeout). Nunca presume 1 (D-8):
 *  sem o atributo → "quantidade por anúncio não confirmada"; corpo null ou valor ilegível → indisponível. */
export function unidadesDoProduto(produto: unknown): Disponivel<number> {
  if (produto == null || typeof produto !== 'object') return { estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' };
  const v = lerUnitsPerPack((produto as { attributes?: unknown }).attributes);
  if (v === undefined) return { estado: 'indisponivel', motivo: QTD_NAO_CONFIRMADA };
  return v === null ? { estado: 'indisponivel', motivo: 'unidades por pacote indisponíveis' } : { estado: 'ok', valor: v };
}

/** Colunas lidas de `variacoes` (+ família) para montar o custo do vínculo. */
export const SELECT_VARIACAO =
  'id, codigo, nome, custo, peso_gramas, altura_cm, largura_cm, comprimento_cm, atualizado_em, familias!inner(origem, kit_multiplicador, kit_base_codigo_pai, nome_pai, codigo_pai, atributos_ml)';

interface FamiliaLinha {
  origem: string | null;
  kit_multiplicador: number | null;
  nome_pai: string | null;
  codigo_pai?: string | null;
  kit_base_codigo_pai?: string | null;
  atributos_ml?: unknown;
}

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
  familias: FamiliaLinha | FamiliaLinha[] | null;
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

/** UNITS_PER_PACK da família-base, por codigo_pai. Linhas da mesma base (lotes/UPDATE) que divergem ou não
 *  declaram → null (não confirmado). */
export type UppDasBases = Map<string, number | null>;

/** Bases de kit vinculado citadas pelas linhas (para buscar o UNITS_PER_PACK delas). */
export function basesDeKit(linhas: LinhaVariacao[]): string[] {
  const s = new Set<string>();
  for (const l of linhas) {
    const f = familia(l);
    if (f?.kit_multiplicador != null && f.kit_base_codigo_pai) s.add(f.kit_base_codigo_pai);
  }
  return [...s];
}

export function uppDasBases(familiasBase: { codigo_pai: string; atributos_ml: unknown }[]): UppDasBases {
  const m: UppDasBases = new Map();
  for (const b of familiasBase) {
    const n = lerUnitsPerPack(b.atributos_ml) ?? null;
    m.set(b.codigo_pai, m.has(b.codigo_pai) && m.get(b.codigo_pai) !== n ? null : n);
  }
  return m;
}

/** Unidades comerciais do SKU, nunca presumidas (D-8):
 *  - SKU comum: UNITS_PER_PACK que ele declara no próprio anúncio (familias.atributos_ml);
 *  - kit vinculado: kit_multiplicador × UNITS_PER_PACK da família-base. O UPP gravado no kit é o próprio
 *    multiplicador (aplicarKitNosAtributos) e não prova a unidade-base (kit de 3 caixas de 24 = 72).
 *  Ausente/ilegível/base desconhecida → null (o painel pede "Unidades no SKU"). */
export function unidadesDoSku(f: FamiliaLinha | null, bases: UppDasBases = new Map()): number | null {
  if (f?.kit_multiplicador != null) {
    const m = Number(f.kit_multiplicador);
    const base = f.kit_base_codigo_pai ? bases.get(f.kit_base_codigo_pai) ?? null : null;
    return base !== null && Number.isInteger(m) && m >= 1 ? m * base : null;
  }
  return lerUnitsPerPack(f?.atributos_ml) ?? null;
}

/** Linha de variação → dimensões válidas do pacote, ou null. */
export function dimensoesDaLinha(l: Pick<LinhaVariacao, 'altura_cm' | 'largura_cm' | 'comprimento_cm' | 'peso_gramas'>) {
  const dim = { altura_cm: num(l.altura_cm), largura_cm: num(l.largura_cm), comprimento_cm: num(l.comprimento_cm), peso_gramas: num(l.peso_gramas) };
  return dimensoesValidas(dim) ? dim : null;
}

/** Linha → VariacaoCusto; família sem origem válida → origem null (conta na ambiguidade; nunca presumida). */
export function variacaoCusto(l: LinhaVariacao, bases: UppDasBases = new Map()): VariacaoCusto {
  const f = familia(l);
  const o = f?.origem;
  const origem = o === 'nacional' || o === 'importado' ? o : null;
  return {
    variacaoId: l.id,
    codigo: l.codigo,
    custo: custoDe(l),
    origem,
    unidades: unidadesDoSku(f, bases),
    codigoPai: f?.codigo_pai ?? null,
    dimensoes: dimensoesDaLinha(l),
  };
}

export const variacoesDasLinhas = (linhas: LinhaVariacao[], bases: UppDasBases = new Map()) =>
  deduplicarPorCodigo(linhas).map((l) => variacaoCusto(l, bases));

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

/** Dimensões próprias do kit vinculado VIVO e canônico de `fator` SKUs da base (resolvedor único de kit,
 *  `listarKitsVivos`: exclui erro, uma família por codigo_pai, a mais recente). Mais de um kit vivo com esse
 *  multiplicador, nenhum, ou variação ambígua → null (frete segue no pacote padrão). */
export async function dimensoesDoKitVivo(
  admin: SupabaseClient, orgId: string, codigoPaiBase: string, fator: number,
): Promise<DimensoesPacote | null> {
  const kits = (await listarKitsVivos(admin, orgId, codigoPaiBase)).filter((k) => k.kit_multiplicador === fator);
  if (kits.length !== 1) return null;
  const { data, error } = await admin.from('variacoes')
    .select('peso_gramas, altura_cm, largura_cm, comprimento_cm').eq('org_id', orgId).eq('familia_id', kits[0].id);
  if (error) throw new Error(`dimensoesDoKitVivo: ${error.message}`);
  const linhas = (data ?? []) as Parameters<typeof dimensoesDaLinha>[0][];
  return linhas.length === 1 ? dimensoesDaLinha(linhas[0]) : null;
}
