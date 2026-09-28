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
  centavos(a.custo) === centavos(b.custo)
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

/**
 * resolverCor + nº de unidades do anúncio (`UNITS_PER_PACK`; null = o ML não informa → vale o cadastro).
 * O kit publica o GTIN da unidade (ADR-0151), então o GTIN casa a base mesmo quando o SKU aponta o kit
 * próprio: com pacote, GTIN e SKU que casam cadastros diferentes precisam dar o mesmo custo e medidas —
 * senão é ambíguo e nada é chutado. Empate vai para o cadastro que já é daquele pacote (piso próprio).
 */
export function resolverPack(
  c: Cadastro,
  q: { item_id: string; variation_id: number | null; sku: string | null; gtin: string | null },
  unidades: number | null,
): CadastroVariacao | MotivoKit | null {
  const r = resolverCor(c, q);
  if (!r) return null;
  const n = unidades ?? r.kit;
  if (n === 1 && r.kit === 1) return r;
  const alvo = paraPack(r, n);
  const outro = q.sku ? c.porCodigo.get(normGtin(q.sku.trim())) : undefined;
  if (!outro || outro === r) return alvo;
  const alt = paraPack(outro, n);
  if (typeof alvo === 'string') return alvo;
  if (typeof alt === 'string') return alt;
  if (!mesmoPacote(alvo, alt)) return 'kit_ambiguo';
  return outro.kit === n && r.kit !== n ? alt : alvo;
}
