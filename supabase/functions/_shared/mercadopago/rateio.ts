// Rateio do frete de um envio compartilhado (pack) por peso, entre as linhas do mesmo
// shipping_id. Zero-soma: a soma dos líquidos do grupo NÃO muda — só a atribuição do frete
// já existente entre as linhas. Corrige o markup por produto quando o ML concentra o frete
// do envio no líquido de um único pagamento. Pura. Ver spec 2026-06-20-rateio-frete-pack.
import type { VendaFinanceira } from './financeiro.ts';
import { round2 } from '../dinheiro.ts';

/** Dados por pagamento usados no rateio (subconjunto de InfoCusto). */
export interface InfoRateio {
  /** Tarifa de venda do ML do item (sale_fee). */
  tarifa?: number;
  /** Peso do produto (g), base do rateio. */
  peso?: number;
  /** Id do envio do ML — linhas com o mesmo id compartilham um frete. */
  shippingId?: string | null;
}

/**
 * Redistribui, por peso, o frete de cada envio compartilhado (>1 venda com o mesmo
 * `shippingId`) entre suas linhas. Grupos de 1 linha ficam intactos. Defensivo: se algum
 * membro não tem tarifa/peso, ou o frete derivado é negativo, o grupo fica cru.
 */
export function ratearFreteCompartilhado(
  vendas: VendaFinanceira[],
  info: Record<string, InfoRateio>,
): VendaFinanceira[] {
  const grupos = new Map<string, VendaFinanceira[]>();
  for (const v of vendas) {
    const sid = info[v.id]?.shippingId;
    if (!sid) continue;
    const g = grupos.get(sid);
    if (g) g.push(v);
    else grupos.set(sid, [v]);
  }

  const ajustada = new Map<string, VendaFinanceira>();
  for (const membros of grupos.values()) {
    if (membros.length < 2) continue;
    // Todo membro precisa de tarifa e peso numéricos, senão não dá pra separar frete.
    if (membros.some((m) => typeof info[m.id]?.tarifa !== 'number' || typeof info[m.id]?.peso !== 'number')) continue;

    const retidoGrupo = membros.reduce((s, m) => s + (m.bruto - m.liquido), 0);
    const tarifaGrupo = membros.reduce((s, m) => s + (info[m.id]!.tarifa as number), 0);
    const freteGrupo = round2(retidoGrupo - tarifaGrupo);
    if (freteGrupo < 0) continue;

    const pesoGrupo = membros.reduce((s, m) => s + (info[m.id]!.peso as number), 0);
    const brutoGrupo = membros.reduce((s, m) => s + m.bruto, 0);
    // Base do rateio: peso; sem peso no grupo, cai para valor (bruto).
    const base = pesoGrupo > 0
      ? membros.map((m) => info[m.id]!.peso as number)
      : membros.map((m) => m.bruto);
    const baseTotal = pesoGrupo > 0 ? pesoGrupo : brutoGrupo;
    if (baseTotal <= 0) continue;

    // Rateia o frete; o resíduo de centavos vai para a linha de maior base.
    const fretes = base.map((b) => round2((freteGrupo * b) / baseTotal));
    const resto = round2(freteGrupo - fretes.reduce((s, f) => s + f, 0));
    let idxMax = 0;
    for (let i = 1; i < base.length; i++) if (base[i] > base[idxMax]) idxMax = i;
    fretes[idxMax] = round2(fretes[idxMax] + resto);

    membros.forEach((m, i) => {
      const liquido = round2(m.bruto - (info[m.id]!.tarifa as number) - fretes[i]);
      ajustada.set(m.id, { ...m, liquido, retido: round2(m.bruto - liquido) });
    });
  }

  return vendas.map((v) => ajustada.get(v.id) ?? v);
}
