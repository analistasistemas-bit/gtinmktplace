// Sparkline em SVG puro (ADR-0125/D10): 40 <ResponsiveContainer> do Recharts por render da tabela
// do Sonar é peso desnecessário para um traço decorativo — um <polyline/> resolve.
interface PontoSparkline {
  data: string;
  total: number;
}

export function Sparkline({ dados }: { dados: PontoSparkline[] }) {
  if (dados.length < 2) return null;

  const valores = dados.map((d) => d.total);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const span = max - min;

  const pontos = valores
    .map((v, i) => {
      const x = (i / (valores.length - 1)) * 80;
      // Série constante (span 0): sem isso a normalização divide por zero — desenha reta no meio.
      const y = span === 0 ? 10 : 20 - ((v - min) / span) * 20;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={80} height={20} viewBox="0 0 80 20" aria-hidden className="shrink-0">
      <polyline points={pontos} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
    </svg>
  );
}
