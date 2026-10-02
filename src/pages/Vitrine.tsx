import { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { carregarVitrine } from '@/lib/vitrine-dados';
import { periodoVitrine, kpisVitrine, ondeAgir, frasesVitrine, type Preset, type ResumoVitrine } from '@/lib/vitrine';
import { PulsoVitrine } from '@/components/vitrine/pulso-vitrine';
import { GraficoVitrine } from '@/components/vitrine/grafico-vitrine';
import { OndeAgir } from '@/components/vitrine/onde-agir';

const PRESETS: { id: Preset; label: string }[] = [
  { id: '4s', label: '4 semanas' }, { id: '12s', label: '12 semanas' }, { id: '6m', label: '6 meses' },
];

export default function Vitrine() {
  const [preset, setPreset] = useState<Preset>('4s');
  const periodo = useMemo(() => periodoVitrine(preset, Date.now()), [preset]);
  const { inicio, fim } = periodo;
  const [dados, setDados] = useState<ResumoVitrine | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro(null);
    carregarVitrine({ inicio, fim }).then((d) => { if (vivo) setDados(d); }).catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [inicio, fim]);

  const kpis = useMemo(() => (dados ? kpisVitrine(dados.itens) : null), [dados]);
  const acoes = useMemo(() => (dados && kpis ? ondeAgir(dados.itens, kpis.atual.conversao) : []), [dados, kpis]);
  const frases = useMemo(() => (dados && kpis ? frasesVitrine(dados, kpis, acoes) : []), [dados, kpis, acoes]);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Vitrine" subtitle="Quem vê seus anúncios e quem compra." />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Período" className="flex gap-1">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={preset === p.id ? 'default' : 'outline'} aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
              {p.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          até {periodo.fim.slice(8, 10)}/{periodo.fim.slice(5, 7)} — o ML fecha as visitas em 48 h
        </p>
      </div>

      {erro ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">Não foi possível carregar a Vitrine: {erro}</p>
      ) : !dados || !kpis ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Carregando">
          <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
        </div>
      ) : dados.itens.length === 0 ? (
        <EmptyState icon={Store} title="Ainda sem visitas coletadas" description="A coleta de visitas roda 1× por dia; volte amanhã." />
      ) : (
        <div className="flex flex-col gap-4">
          <PulsoVitrine kpis={kpis} frases={frases} />
          <GraficoVitrine semanas={dados.semanas} inicio={periodo.inicio} fim={periodo.fim} />
          <OndeAgir acoes={acoes} />
        </div>
      )}
    </div>
  );
}
