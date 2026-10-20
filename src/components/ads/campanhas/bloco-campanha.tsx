import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Table, TableHeader, TableBody, TableHead, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { CampanhaVista } from '@/lib/ads-campanhas';
import { LinhaFamilia, CartaoFamilia, type AcoesFamilia } from './familia-campanha';
import { LinhaMlb } from './linha-mlb';
import { fmtPontos, rotuloEstrategia } from './formato-campanha';

const TH = 'px-3 align-bottom whitespace-normal';

function Meta({ c }: { c: CampanhaVista }) {
  const partes: React.ReactNode[] = [];
  if (c.orcamentoDiario != null) partes.push(<span key="o">Orçamento diário {fmtBRL(c.orcamentoDiario)}</span>);
  if (c.roasObjetivo != null) {
    partes.push(
      <span key="r">
        ROAS objetivo {Number(c.roasObjetivo.toFixed(1)).toLocaleString('pt-BR')}x
        {c.acosObjetivo != null && <span className="text-muted-foreground/80"> (ACOS-alvo {fmtPontos(c.acosObjetivo)})</span>}
      </span>,
    );
  } else if (c.acosObjetivo != null) {
    partes.push(<span key="a">ACOS-alvo {fmtPontos(c.acosObjetivo)}</span>);
  }
  const n = c.familias.reduce((s, f) => s + f.anuncios.length, 0) + c.foraDoPubliai.length;
  partes.push(<span key="n">{n} {n === 1 ? 'anúncio patrocinado' : 'anúncios patrocinados'}</span>);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground tabular-nums">
      {partes.map((p, i) => <span key={i} className="inline-flex items-center gap-2">{i > 0 && <span aria-hidden>·</span>}{p}</span>)}
    </p>
  );
}

/** Uma campanha: cabeçalho, famílias (tabela no xl, cartões abaixo) e o grupo "Fora do PubliAI". Pausada nasce recolhida. */
export function BlocoCampanha({ c, filtrando, verDesempenho, temDesempenho }: { c: CampanhaVista; filtrando: boolean } & AcoesFamilia) {
  const ativa = c.status === 'active';
  const [aberta, setAberta] = useState(ativa);
  const id = useId();
  const estrategia = rotuloEstrategia(c.estrategia);
  const mostrar = aberta || filtrando;
  const acoes = { verDesempenho, temDesempenho };
  return (
    <section aria-labelledby={`${id}-t`} className={cn('space-y-3 rounded-lg border border-border bg-card p-4', !ativa && 'bg-muted/30')}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${id}-t`} className={cn('text-h3 break-words', !ativa && 'text-muted-foreground')}>{c.nome}</h2>
            <StatusPill tone={ativa ? 'success' : 'neutral'}>{ativa ? 'Ativa' : 'Pausada'}</StatusPill>
            {estrategia && <StatusPill tone="neutral">{estrategia}</StatusPill>}
          </div>
          <Meta c={c} />
        </div>
        {!ativa && !filtrando && (
          <Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" aria-expanded={aberta} aria-controls={`${id}-c`}
            aria-label={`${aberta ? 'Recolher' : 'Expandir'} ${c.nome}`} onClick={() => setAberta(v => !v)}>
            {aberta ? 'Recolher' : 'Expandir'}
            <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', aberta && 'rotate-180')} />
          </Button>
        )}
      </header>
      {mostrar && (
        <div id={`${id}-c`} className="space-y-4">
          {c.familias.length > 0 && (
            <>
              <div className="hidden rounded-lg border border-border xl:block">
                <Table aria-label={`Famílias de ${c.nome}`} className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col" className={cn(TH, 'w-[30%]')}>Família</TableHead>
                      <TableHead scope="col" className={cn(TH, 'w-[16%]')}>Patrocínio</TableHead>
                      <TableHead scope="col" className={cn(TH, 'w-[28%]')}>Margem para Ads</TableHead>
                      <TableHead scope="col" className={cn(TH, 'w-[20%]')}>Alertas</TableHead>
                      <TableHead scope="col" className={cn(TH, 'w-[6%] text-right')}><span className="sr-only">Detalhes</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.familias.map(f => <LinhaFamilia key={f.codigoPai} f={f} campanha={c} {...acoes} />)}
                  </TableBody>
                </Table>
              </div>
              <ul aria-label={`Famílias de ${c.nome} em cartões`} className="grid gap-3 md:grid-cols-2 xl:hidden">
                {c.familias.map(f => <CartaoFamilia key={f.codigoPai} f={f} campanha={c} {...acoes} />)}
              </ul>
            </>
          )}
          {c.foraDoPubliai.length > 0 && !filtrando && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-muted-foreground">Fora do PubliAI</h3>
              <p className="text-xs text-muted-foreground">Anúncios sem família no PubliAI: sem margem calculada.</p>
              <ul aria-label="Anúncios fora do PubliAI" className="divide-y divide-border">
                {c.foraDoPubliai.map(a => <LinhaMlb key={a.mlb} a={a} equilibrio={false} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
