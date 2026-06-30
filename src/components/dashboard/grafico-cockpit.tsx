import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { PontoSerie } from '@/lib/resumo-vendas';

export type MetricaGrafico = 'liquido' | 'pedidos';

/** Evolução de vendas em área. Plota líquido (R$) ou nº de pedidos, conforme `metrica`. Vazio → aviso. */
export function GraficoCockpit({
  serie,
  metrica,
  rotuloDinheiro = 'Líquido',
}: {
  serie: PontoSerie[];
  metrica: MetricaGrafico;
  rotuloDinheiro?: string;
}) {
  if (serie.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sem vendas no período.
      </div>
    );
  }
const ehDinheiro = metrica === 'liquido';
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-cockpit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="var(--muted-foreground)"
            width={40}
            tickFormatter={(v) =>
              ehDinheiro ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)) : fmtInt(Number(v))
            }
          />
          <Tooltip
            formatter={(v) => [ehDinheiro ? fmtBRL(Number(v)) : fmtInt(Number(v)), ehDinheiro ? rotuloDinheiro : 'Pedidos']}
            labelClassName="text-foreground"
            contentStyle={{ fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey={metrica}
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#grad-cockpit)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
