import { DollarSign, Package, Percent, Scale, TrendingUp, Undo2 } from 'lucide-react';
import { KpiCard } from '@/components/ui/kpi-card';
import { fmtBRL, fmtBRLSinal, fmtInt, fmtMarkup } from '@/lib/formato';
import { deltaPp, deltaValor, type Delta, type LinhaSku } from '@/lib/vendas-sku';

// Idioma do app para "sem valor" (o mesmo da aba Vendas SKU).
const NADA = '—';
const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
// Mesmo comDelta da aba Vendas SKU: Δ zero sem sinal nem cor.
const comDelta = (d: Delta | null, rot: string) => (!d ? {}
  : { delta: `${d.tendencia === 'neutral' ? d.texto.replace(/^[+−]/, '') : d.texto} ${rot}`, deltaTrend: d.tendencia });

const HINT_CUSTO = { parcial: 'Parcial: só os itens com custo', estimado: 'Com custo estimado do cadastro', sem_custo: 'Sem custo cadastrado', real: undefined } as const;

/** KPIs do período, na mesma apresentação da aba Vendas SKU. Linha null = nenhuma venda no recorte:
 *  faturamento e unidades são 0 de verdade; as razões ficam sem valor. */
export function KpisDossie({ atual, anterior, rot, unidadesKit = 0 }: {
  atual: LinhaSku | null; anterior: LinhaSku | null; rot: string;
  /** Unidades do período vendidas dentro de Kit Virtual (já contadas em Unidades). */
  unidadesKit?: number;
}) {
  const bruto = atual?.acc.bruto ?? 0;
  const unidades = atual?.acc.unidades ?? 0;
  const lucro = atual?.m.lucro ?? null;
  const markup = atual?.m.markup ?? null;
  const margem = atual?.m.margemSVenda ?? null;
  const devol = atual?.m.taxaDevolucao ?? null;
  const a = anterior ? { bruto: anterior.acc.bruto, unidades: anterior.acc.unidades, ...anterior.m } : null;
  const aBruto = a?.bruto ?? 0;
  const aUnid = a?.unidades ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <KpiCard size="compact" icon={DollarSign} label="Faturamento" tom="success" value={fmtBRL(bruto)}
        hint={atual && unidades > 0 ? `${fmtBRL(atual.m.ticket)}/un. em média` : undefined}
        {...comDelta(deltaValor(bruto, aBruto, fmtBRL), rot)} />
      <KpiCard size="compact" icon={TrendingUp} label="Lucro" infoKey="Lucro::vendas-sku"
        tom={lucro == null ? 'info' : lucro < 0 ? 'danger' : 'success'}
        valueClassName={lucro == null ? undefined : lucro < 0 ? 'text-destructive' : 'text-success'}
        value={lucro == null ? NADA : fmtBRLSinal(lucro)}
        hint={atual ? HINT_CUSTO[atual.m.fonteCusto] : undefined}
        {...comDelta(deltaValor(lucro, a?.lucro ?? null, fmtBRL), rot)} />
      <KpiCard size="compact" icon={Percent} label="Markup" infoKey="Markup::vendas-sku" tom="info" value={fmtMarkup(markup)}
        {...comDelta(deltaPp(markup, a?.markup ?? null), rot)} />
      <KpiCard size="compact" icon={Scale} label="Margem s/ venda" infoKey="Margem s/ venda::vendas-sku" tom="info" value={pct(margem)}
        {...comDelta(deltaPp(margem, a?.margemSVenda ?? null), rot)} />
      <KpiCard size="compact" icon={Package} label="Unidades" infoKey="Unidades::vendas-sku" tom="info" value={fmtInt(unidades)}
        hint={atual ? `${fmtInt(atual.acc.pedidos)} ${atual.acc.pedidos === 1 ? "pedido" : "pedidos"}${unidadesKit ? ` · ${fmtInt(unidadesKit)} un. dentro de kit` : ''}` : undefined}
        {...comDelta(deltaValor(unidades, aUnid, fmtInt), rot)} />
      <KpiCard size="compact" icon={Undo2} label="Devolução"
        tom={atual?.acc.pedidosDevolvidos ? 'warning' : 'info'} value={pct(devol)}
        hint={atual && atual.acc.pedidosBaseDevolucao > 0
          ? `${fmtInt(atual.acc.pedidosDevolvidos)} de ${fmtInt(atual.acc.pedidosBaseDevolucao)} ${atual.acc.pedidosBaseDevolucao === 1 ? 'pedido' : 'pedidos'}`
          : undefined}
        {...comDelta(deltaPp(devol, a?.taxaDevolucao ?? null), rot)} />
    </div>
  );
}
