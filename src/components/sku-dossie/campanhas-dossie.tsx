import { Megaphone } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { rotuloTipo, STATUS_CAMPANHA, STATUS_CAMPANHA_DOT } from '@/lib/promocoes';
import type { DossieSku } from '@/lib/sku-dossie';
import { BlocoDossie } from './bloco-dossie';
import { diaMesBRT, diaMesHoraBRT } from './formato-dossie';

type Situacao = DossieSku['campanhas'][number];

// Mesma leitura da Central de Promoções: `started`/`pending` = participando, `candidate` = convidado.
const ITEM: Record<string, { label: string; tom: StatusTone; ordem: number }> = {
  started: { label: 'Participando', tom: 'success', ordem: 0 },
  pending: { label: 'Participando', tom: 'success', ordem: 0 },
  candidate: { label: 'Convidado', tom: 'info', ordem: 1 },
};
const item = (s: string) => ITEM[s] ?? { label: s, tom: 'neutral' as StatusTone, ordem: 2 };

function vigencia({ inicio, fim }: Situacao['vigencia']): string {
  if (inicio && fim) return `${diaMesBRT(inicio)} a ${diaMesBRT(fim)}`;
  if (fim) return `até ${diaMesBRT(fim)}`;
  if (inicio) return `desde ${diaMesBRT(inicio)}`;
  return 'vigência não informada';
}

/** Situação atual nas campanhas do ML, na última sincronização. Nunca "data de adesão": o ML não
 *  guarda quando o anúncio entrou ou saiu, então a participação histórica é desconhecida. */
export function CampanhasDossie({ campanhas }: { campanhas: DossieSku['campanhas'] }) {
  const lista = [...campanhas].sort((a, b) => item(a.statusItem).ordem - item(b.statusItem).ordem
    || Date.parse(b.vigencia.fim ?? '') - Date.parse(a.vigencia.fim ?? '') || a.mlb.localeCompare(b.mlb));

  return (
    <BlocoDossie id="dossie-campanhas" titulo="Campanhas"
      relogio="Situação atual nas campanhas, da última sincronização; participação histórica desconhecida">
      {lista.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhuma campanha nos anúncios deste código" className="flex-1"
          description="Quando um anúncio for convidado ou entrar numa campanha do Mercado Livre, a situação aparece aqui depois da sincronização." />
      ) : (
        <ul className="flex-1 divide-y rounded-lg border bg-card shadow-sm">
          {lista.map((c, i) => {
            const it = item(c.statusItem);
            return (
              <li key={`${c.mlb}:${i}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {c.tipo ? rotuloTipo(c.tipo) : 'Campanha'}
                    {c.statusCampanha && (
                      <span className="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal">
                        <span className={cn('size-1.5 rounded-full', STATUS_CAMPANHA_DOT[c.statusCampanha] ?? 'bg-muted-foreground/50')} aria-hidden />
                        {`Campanha ${(STATUS_CAMPANHA[c.statusCampanha] ?? c.statusCampanha).toLowerCase()}`}
                      </span>
                    )}
                  </p>
                  <p className="text-sm font-medium leading-snug">{c.nome ?? (c.tipo ? rotuloTipo(c.tipo) : 'Campanha fora da lista atual')}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{`${c.mlb} · ${vigencia(c.vigencia)}`}</p>
                </div>
                <div className="flex shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
                  <StatusPill tone={it.tom}>{it.label}</StatusPill>
                  {c.precoPromo != null && (
                    <p className="text-sm tabular-nums">
                      <span className="font-semibold">{fmtBRL(c.precoPromo)}</span>
                      <span className="text-xs text-muted-foreground"> preço promocional</span>
                    </p>
                  )}
                  <p className="text-xs tabular-nums text-muted-foreground">{`sincronizado em ${diaMesHoraBRT(c.sincronizadoEm)}`}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </BlocoDossie>
  );
}
