import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { serieVitrine, type SemanaVitrine } from '@/lib/vitrine';
import { InfoDica, DicaTexto } from '@/components/vitrine/info-dica';
import { DICAS } from '@/components/vitrine/dicas';
import { EIXO, EIXO_LUCRO, EIXO_UNID, MARGEM, TOOLTIP, kCompacto } from '@/components/sku-dossie/serie-pontos';

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const dec1 = (x: number) => x.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function GraficoVitrine({ semanas, inicio, fim }: { semanas: SemanaVitrine[]; inicio: string; fim: string }) {
  const dados = useMemo(() => serieVitrine(semanas, inicio, fim).map((p) => ({ ...p, rotulo: ddmm(p.semana) })), [semanas, inicio, fim]);
  // máximo < 10 visitas/dia: eixo com fração (senão 0, 1, 1, 2… repetidos)
  const fracao = dados.every((p) => (p.visitasDia ?? 0) < 10);
  return (
    <section aria-labelledby="vitrine-serie" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        <h2 id="vitrine-serie" className="text-sm font-medium">Visitas por dia e conversão por semana</h2>
        <InfoDica titulo="Visitas por dia e conversão por semana"><DicaTexto {...DICAS.grafico} /></InfoDica>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-1" />Visitas por dia (média da semana)</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-success" />Conversão (eixo à direita)</li>
      </ul>
      <div className="h-60 sm:h-64" role="img" aria-label="Gráfico de visitas por dia (barras) e conversão (linha) por semana">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 240 }}>
          <ComposedChart data={dados} margin={{ top: 16, right: MARGEM, left: MARGEM, bottom: 0 }}>
            <CartesianGrid yAxisId="v" strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" interval="preserveStartEnd" minTickGap={12} />
            <YAxis yAxisId="v" width={EIXO_UNID + 8} tick={EIXO} stroke="var(--border)" allowDecimals={fracao} tickFormatter={(v) => (fracao ? dec1(Number(v)) : kCompacto(Number(v)))} />
            <YAxis yAxisId="c" orientation="right" width={EIXO_LUCRO + 8} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => pct(Number(v))} />
            <Tooltip {...TOOLTIP}
              labelFormatter={(_, payload) => {
                const d = payload?.[0]?.payload as { rotulo: string; dias: number } | undefined;
                return d ? `Semana de ${d.rotulo}${d.dias < 7 ? ` · ${d.dias} ${d.dias === 1 ? 'dia' : 'dias'} no período` : ''}` : '';
              }}
              formatter={(v, nome) => [nome === 'Conversão' ? pct(Number(v)) : dec1(Number(v)), nome]} />
            <Bar yAxisId="v" dataKey="visitasDia" name="Visitas por dia" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            <Line yAxisId="c" dataKey="conv" name="Conversão" stroke="var(--success)" strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--success)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">Cada ponto é uma semana (seg–dom). Semana sem cobertura suficiente fica em branco.</p>
    </section>
  );
}
