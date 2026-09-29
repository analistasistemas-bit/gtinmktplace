// ADR-0170 — liga um anúncio da promoção à variação do cadastro. Mesma cadeia do custo vigente
// (_shared/faturamento/custo-vigente.ts: variação → anúncio → GTIN → código) com o vínculo de item
// filho UP na frente. Desempate: linha COM custo vence linha sem custo; entre iguais, a mais recente
// (ADR-0108). Diferença intencional: "anúncio" só resolve anúncio de cor única (o financeiro resolve
// uma venda; aqui cada cor precisa do próprio custo). Puro.
// ponytail: cópia enxuta — o custo-vigente devolve só o custo e é amarrado por paridade ao front;
// aqui precisamos de piso/origem/dimensões/cor.
import { normGtin } from '../faturamento/venda.ts';
import type { CadastroVariacao, MotivoKit, Origem } from './tipos.ts';

export interface LinhaVariacao {
  id: string; custo: unknown; preco: unknown; cor: string | null; codigo: string | null; gtin: string | null;
  ml_variation_id: string | number | null; peso_gramas: unknown; altura_cm: unknown; largura_cm: unknown;
  comprimento_cm: unknown; atualizado_em: unknown;
  familias: LinhaFamilia | LinhaFamilia[] | null;
}
type LinhaFamilia = { ml_item_id: string | null; origem: string | null; kit_multiplicador?: number | null };
export interface LinhaItemUp { item_externo_id: string; variacao_id: string }

export interface Cadastro {
  porId: Map<string, CadastroVariacao>;
  porItemUp: Map<string, string>;
  porVariacaoMl: Map<string, CadastroVariacao>;
  porCodigo: Map<string, CadastroVariacao>;
  porGtin: Map<string, CadastroVariacao>;
  porItem: Map<string, CadastroVariacao[]>;
}

const numOuNull = (x: unknown): number | null => {
  const n = Number(x);
  return x == null || x === '' || !Number.isFinite(n) ? null : n;
};
const instante = (x: unknown): number => {
  const t = typeof x === 'string' ? Date.parse(x) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

export function montarCadastro(variacoes: LinhaVariacao[], itensUp: LinhaItemUp[]): Cadastro {
  const c: Cadastro = {
    porId: new Map(), porItemUp: new Map(), porVariacaoMl: new Map(),
    porCodigo: new Map(), porGtin: new Map(), porItem: new Map(),
  };
  const quando = new Map<CadastroVariacao, number>();
  const recente = (m: Map<string, CadastroVariacao>, k: string, val: CadastroVariacao) => {
    const atual = m.get(k);
    const vence = !atual
      || (val.custo != null && atual.custo == null)
      || ((val.custo != null) === (atual.custo != null) && quando.get(val)! > quando.get(atual)!);
    if (vence) m.set(k, val);
  };

  for (const r of variacoes) {
    const fam = Array.isArray(r.familias) ? r.familias[0] : r.familias;
    const custo = numOuNull(r.custo);
    const preco = numOuNull(r.preco);
    const origem: Origem = fam?.origem === 'nacional' || fam?.origem === 'importado' ? fam.origem : null;
    const altura = numOuNull(r.altura_cm), largura = numOuNull(r.largura_cm);
    const comprimento = numOuNull(r.comprimento_cm), peso = numOuNull(r.peso_gramas);
    const dimOk = [altura, largura, comprimento, peso].every((n) => n != null && n > 0);
    const val: CadastroVariacao = {
      variacao_id: r.id,
      custo: custo != null && custo > 0 ? custo : null,
      piso: preco != null && preco > 0 ? preco : null,
      origem,
      cor: r.cor,
      codigo: r.codigo,
      dim: dimOk ? { altura_cm: altura!, largura_cm: largura!, comprimento_cm: comprimento!, peso_gramas: peso! } : null,
      kit: Number(fam?.kit_multiplicador) >= 2 ? Number(fam!.kit_multiplicador) : 1,
    };
    quando.set(val, instante(r.atualizado_em));
    c.porId.set(r.id, val);
    if (r.ml_variation_id != null) recente(c.porVariacaoMl, String(r.ml_variation_id), val);
    if (r.codigo) recente(c.porCodigo, normGtin(r.codigo.trim()), val);
    if (r.gtin) recente(c.porGtin, normGtin(r.gtin.trim()), val);
    if (fam?.ml_item_id) c.porItem.set(fam.ml_item_id, [...(c.porItem.get(fam.ml_item_id) ?? []), val]);
  }
  for (const u of itensUp) c.porItemUp.set(u.item_externo_id, u.variacao_id);
  return c;
}

export function resolverCor(
  c: Cadastro,
  q: { item_id: string; variation_id: number | null; sku: string | null; gtin: string | null },
): CadastroVariacao | null {
  const up = c.porItemUp.get(q.item_id);
  if (up && c.porId.has(up)) return c.porId.get(up)!;
  if (q.variation_id != null) {
    const r = c.porVariacaoMl.get(String(q.variation_id));
    if (r) return r;
  }
  const doItem = c.porItem.get(q.item_id);
  if (doItem && doItem.length === 1) return doItem[0];
  if (q.gtin) {
    const r = c.porGtin.get(normGtin(q.gtin.trim()));
    if (r) return r;
  }
  if (q.sku) {
    const r = c.porCodigo.get(normGtin(q.sku.trim()));
    if (r) return r;
  }
  return null;
}

const centavos = (x: number | null) => (x == null ? null : Math.round(x * 100));
const mesmoPacote = (a: CadastroVariacao, b: CadastroVariacao) =>
  a.origem === b.origem && centavos(a.custo) === centavos(b.custo)
  && JSON.stringify(a.dim && Object.values(a.dim).map(centavos)) === JSON.stringify(b.dim && Object.values(b.dim).map(centavos));

/**
 * Leva a variação a `n` unidades (ADR-0151). Kit próprio já nasce multiplicado no cadastro — nunca
 * multiplica de novo; unidade avulsa num anúncio de N escala custo/piso/peso/altura por N (D-4:
 * largura e comprimento seguem a base). Kit sem medidas não cota frete padrão (o ML cobra a maior).
 */
function paraPack(v: CadastroVariacao, n: number): CadastroVariacao | MotivoKit {
  if (v.kit === n) return n > 1 && !v.dim ? 'kit_sem_dimensao' : v;
  if (v.kit !== 1) return 'kit_divergente';
  if (!v.dim) return 'kit_sem_dimensao';
  const x = (y: number | null) => (y == null ? null : Math.round(y * n * 100) / 100);
  return {
    ...v, kit: n, custo: x(v.custo), piso: x(v.piso),
    dim: { ...v.dim, altura_cm: v.dim.altura_cm! * n, peso_gramas: v.dim.peso_gramas! * n }, // montarCadastro só cria dim com os 4 > 0
  };
}

type Lado = { v: CadastroVariacao; p: CadastroVariacao | MotivoKit };

/** Duas leituras do mesmo anúncio no pacote de `n`: precisam bater; empate vai para o cadastro nativo do pacote. */
function combinar(a: Lado, b: Lado, n: number): Lado | MotivoKit {
  if (typeof a.p === 'string' || typeof b.p === 'string') {
    // Um lado inválido: só serve o outro se ele já for o cadastro daquele pacote, completo.
    if (typeof b.p !== 'string' && b.v.kit === n) return b;
    if (typeof a.p !== 'string' && a.v.kit === n) return a;
    return (typeof a.p === 'string' ? a.p : b.p) as MotivoKit;
  }
  if (!mesmoPacote(a.p, b.p)) return 'kit_ambiguo';
  return b.v.kit === n && a.v.kit !== n ? b : a;
}

/**
 * resolverCor + nº de unidades do anúncio (`UNITS_PER_PACK`; null = o ML não informa → vale o cadastro).
 * O kit publica o GTIN da unidade (ADR-0151), então o GTIN casa a base mesmo quando o SKU ou o vínculo
 * apontam o kit próprio: com pacote, todo cadastro que o SKU e o GTIN casam precisa dar o mesmo custo,
 * medidas e origem que o resolvido — senão é ambíguo e nada é chutado. Consequência aceita: custo da base
 * reajustado sem refletir no kit (ADR-0151 não propaga) deixa o kit ⚪ até o cadastro ser alinhado.
 * `formatoKit` (SALE_FORMAT=Kit) sem quantidade e sem cadastro de kit → ⚪.
 */
export function resolverPack(
  c: Cadastro,
  q: { item_id: string; variation_id: number | null; sku: string | null; gtin: string | null },
  unidades: number | null,
  formatoKit = false,
): CadastroVariacao | MotivoKit | null {
  const r = resolverCor(c, q);
  if (!r) return null;
  const casa = (m: Map<string, CadastroVariacao>, k: string | null) => (k ? m.get(normGtin(k.trim())) : undefined);
  const outros = [...new Set([casa(c.porCodigo, q.sku), casa(c.porGtin, q.gtin)])]
    .filter((o): o is CadastroVariacao => o != null && o !== r);
  const n = unidades ?? Math.max(r.kit, ...outros.map((o) => o.kit));
  // Fora de pacote a cadeia do resolverCor vale como sempre (ADR-0108).
  if (n === 1) return r.kit !== 1 || (unidades == null && formatoKit) ? 'kit_divergente' : r;
  let atual: Lado = { v: r, p: paraPack(r, n) };
  for (const o of outros) {
    const x = combinar(atual, { v: o, p: paraPack(o, n) }, n);
    if (typeof x === 'string') return x;
    atual = x;
  }
  return atual.p;
}
