import { ArrowDown, ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { InfoDica, DicaTexto } from '@/components/vitrine/info-dica';
import { DICAS } from '@/components/vitrine/dicas';
import { delta, deltaPP, type KpisVitrine } from '@/lib/vitrine';

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

const num = (x: number, casas: number) => Math.abs(x).toFixed(casas).replace('.', ',');

// pp = Δ absoluto em pontos percentuais (Conversão); senão Δ relativo em %
function Delta({ atual, anterior, pp }: { atual: number | null; anterior: number | null; pp?: boolean }) {
  const rel = delta(atual, anterior);
  const d = pp ? deltaPP(atual, anterior) : rel == null ? null : rel * 100;
  if (d == null) return null;
  const casas = pp ? 2 : 1;
  const texto = `${num(d, casas)}${pp ? ' p.p.' : '%'}`;
  const sinal = Number(d.toFixed(casas)) === 0 ? 0 : Math.sign(d);
  const Seta = sinal > 0 ? ArrowUp : sinal < 0 ? ArrowDown : null;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', sinal > 0 ? 'text-success' : sinal < 0 ? 'text-danger' : 'text-muted-foreground')}>
      <span aria-hidden className="inline-flex items-center gap-0.5">{Seta && <Seta className="size-3" />}{texto}</span>
      <span className="sr-only">{sinal > 0 ? ' alta de' : sinal < 0 ? ' queda de' : ' sem variação'} {sinal === 0 ? '' : `${texto} `}contra o período anterior</span>
    </span>
  );
}

function Card({ titulo, dica, valor, atual, anterior, pp }: { titulo: string; dica: keyof typeof DICAS; valor: string | null; atual: number | null; anterior: number | null; pp?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {titulo}
        <InfoDica titulo={titulo}><DicaTexto {...DICAS[dica]} /></InfoDica>
      </div>
      <div className="flex items-baseline gap-2">
        {valor == null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help text-2xl font-semibold text-muted-foreground" aria-label="Sem dado: cobertura insuficiente">—</button>
            </TooltipTrigger>
            <TooltipContent>cobertura insuficiente</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-2xl font-semibold tabular-nums">{valor}</span>
        )}
        <Delta atual={atual} anterior={anterior} pp={pp} />
      </div>
    </div>
  );
}

export function PulsoVitrine({ kpis, frases }: { kpis: KpisVitrine; frases: string[] }) {
  const { atual: a, anterior: b } = kpis;
  return (
    <section aria-label="Resumo" className="flex flex-col gap-3">
      <TooltipProvider>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card titulo="Visitas" dica="visitas" valor={a.visitas == null ? null : fmtInt(a.visitas)} atual={a.visitas} anterior={b.visitas} />
          <Card titulo="Conversão" dica="conversao" valor={a.conversao == null ? null : pct(a.conversao)} atual={a.conversao} anterior={b.conversao} pp />
          <Card titulo="Venda por visita" dica="vendaPorVisita" valor={a.vendaPorVisita == null ? null : fmtBRL(a.vendaPorVisita)} atual={a.vendaPorVisita} anterior={b.vendaPorVisita} />
        </div>
      </TooltipProvider>
      {a.avisoCobertura && <p className="text-xs text-muted-foreground">Dados de {pct(a.cobertura)} dos dias medidos.</p>}
      {frases.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {frases.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </section>
  );
}
