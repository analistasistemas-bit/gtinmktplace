// ADR-0170 — liga um anúncio da promoção à variação do cadastro. Mesma cadeia do custo vigente
// (_shared/faturamento/custo-vigente.ts: variação → anúncio → GTIN → código) com o vínculo de item
// filho UP na frente. Desempate: linha COM custo vence linha sem custo; entre iguais, a mais recente
// (ADR-0108). Diferença intencional: "anúncio" só resolve anúncio de cor única (o financeiro resolve
// uma venda; aqui cada cor precisa do próprio custo). Puro.
// ponytail: cópia enxuta — o custo-vigente devolve só o custo e é amarrado por paridade ao front;
// aqui precisamos de piso/origem/dimensões/cor.
import { normGtin } from '../faturamento/venda.ts';
import type { CadastroVariacao, Origem } from './tipos.ts';

export interface LinhaVariacao {
  id: string; custo: unknown; preco: unknown; cor: string | null; codigo: string | null; gtin: string | null;
  ml_variation_id: string | number | null; peso_gramas: unknown; altura_cm: unknown; largura_cm: unknown;
  comprimento_cm: unknown; atualizado_em: unknown;
  familias: { ml_item_id: string | null; origem: string | null } | { ml_item_id: string | null; origem: string | null }[] | null;
}
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
    const origem: Origem = fam?.origem === 'nacional' || fam?.origem === 'importado' ? fam.origem : null;
    const altura = numOuNull(r.altura_cm), largura = numOuNull(r.largura_cm);
    const comprimento = numOuNull(r.comprimento_cm), peso = numOuNull(r.peso_gramas);
    const dimOk = [altura, largura, comprimento, peso].every((n) => n != null && n > 0);
    const val: CadastroVariacao = {
      variacao_id: r.id,
      custo: custo != null && custo > 0 ? custo : null,
      piso: numOuNull(r.preco),
      origem,
      cor: r.cor,
      codigo: r.codigo,
      dim: dimOk ? { altura_cm: altura!, largura_cm: largura!, comprimento_cm: comprimento!, peso_gramas: peso! } : null,
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
