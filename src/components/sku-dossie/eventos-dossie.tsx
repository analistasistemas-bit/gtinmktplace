import { History } from 'lucide-react';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { Evento } from '@/lib/sku-dossie';
import { TIPO_EVENTO, EVENTO_DE_ESTOQUE } from './tipos-evento';

// Mês e hora no fuso de São Paulo: um evento às 02:00Z do dia 1º ainda é do mês anterior.
const MES = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
const QUANDO = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Linha do tempo do SKU, do mais recente para o mais antigo, agrupada por mês. */
export function EventosDossie({ eventos }: { eventos: Evento[] }) {
  const meses: { mes: string; itens: Evento[] }[] = [];
  for (const e of [...eventos].reverse()) {
    const mes = MES.format(new Date(e.em));
    const ultimo = meses[meses.length - 1];
    if (ultimo?.mes === mes) ultimo.itens.push(e); else meses.push({ mes, itens: [e] });
  }

  return (
    <section aria-labelledby="dossie-eventos" className="flex flex-col gap-3">
      <div>
        <h2 id="dossie-eventos" className="text-h3">Eventos</h2>
        <p className="text-xs text-muted-foreground">Todo o histórico observado: estoque, moderação e devoluções, do mais recente ao mais antigo.</p>
      </div>
      {meses.length === 0 ? (
        <EmptyState icon={History} title="Nenhum evento registrado"
          description="Entradas de estoque, rupturas, moderações e devoluções deste código aparecem aqui quando acontecem." />
      ) : (
        <div className="flex flex-col gap-5 rounded-lg border bg-card p-4 shadow-sm">
          {meses.map(({ mes, itens }) => (
            <div key={mes} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{mes}</h3>
              <ol className="ml-3.5 flex flex-col gap-4 border-l">
                {itens.map((e) => {
                  const t = TIPO_EVENTO[e.tipo];
                  return (
                    <li key={e.id} className="relative pl-6">
                      <span className={cn('absolute -left-3.5 top-0 grid size-7 place-items-center rounded-full ring-4 ring-card', t.fundo, t.cor)}>
                        <t.Icone className="size-3.5" aria-hidden />
                      </span>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="text-sm font-medium">{e.titulo}</p>
                        <time dateTime={e.em} className="text-xs tabular-nums text-muted-foreground">{QUANDO.format(new Date(e.em))}</time>
                      </div>
                      {e.detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{e.detalhe}</p>}
                      {(e.vinculo === 'compartilhado' || e.vinculo === 'nao_resolvido' || (e.estoqueDaBase && EVENTO_DE_ESTOQUE.has(e.tipo))) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {e.vinculo === 'compartilhado' && (
                            <StatusPill tone="info" title="O anúncio vende este e outros códigos: o evento pode ser de outro deles.">
                              {`anúncio compartilhado · ${e.mlb}`}
                            </StatusPill>
                          )}
                          {e.vinculo === 'nao_resolvido' && (
                            <StatusPill tone="warning" title={`${e.mlb ?? 'O anúncio'} não está no mapa de anúncios deste código.`}>vínculo não resolvido</StatusPill>
                          )}
                          {e.estoqueDaBase && EVENTO_DE_ESTOQUE.has(e.tipo) && (
                            <StatusPill tone="neutral" title="O kit não tem estoque próprio: o saldo vem da base.">estoque da base</StatusPill>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
