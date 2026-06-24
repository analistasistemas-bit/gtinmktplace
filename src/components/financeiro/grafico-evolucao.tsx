import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { fmtBRL } from '@/lib/formato';
import type { PontoSerie } from '@/lib/resumo-vendas';

/** Evolução do líquido por dia/semana no período. Vazio → mensagem. */
export function GraficoEvolucao({ serie }: { serie: PontoSerie[] }) {
  if (serie.length === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Sem vendas no período.</div>;
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)"
            tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} width={40} />
          <Tooltip
            formatter={(v) => [fmtBRL(Number(v)), 'Líquido']}
            labelClassName="text-foreground" contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="liquido" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
