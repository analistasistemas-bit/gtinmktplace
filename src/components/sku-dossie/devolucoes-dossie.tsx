import { fmtInt } from '@/lib/formato';
import type { Evento } from '@/lib/sku-dossie';
import type { LinhaSku } from '@/lib/vendas-sku';
import { BlocoDossie } from './bloco-dossie';
import { pctBR } from './formato-dossie';

const SEM_MOTIVO = 'não informado';
// Idioma do app para "sem valor" (o mesmo dos KPIs).
const NADA = '—';

/** Uma contagem por devolução: o claim gera "aberta" e "encerrada" com o mesmo id antes do ":". */
function motivos(eventos: Evento[]): { motivo: string; n: number }[] {
  const porClaim = new Map<string, string>();
  for (const e of eventos) {
    if (e.tipo !== 'devolucao_aberta' && e.tipo !== 'devolucao_estorno') continue;
    // ponytail: o motivo chega no detalhe do evento ("Motivo: X"), montado em montarEventos.
    const m = e.detalhe?.replace(/^Motivo:\s*/, '').trim();
    porClaim.set(e.id.split(':')[0], m || SEM_MOTIVO);
  }
  const cont = new Map<string, number>();
  for (const m of porClaim.values()) cont.set(m, (cont.get(m) ?? 0) + 1);
  return [...cont].map(([motivo, n]) => ({ motivo, n }))
    .sort((a, b) => b.n - a.n || Number(a.motivo === SEM_MOTIVO) - Number(b.motivo === SEM_MOTIVO) || a.motivo.localeCompare(b.motivo));
}

/** Taxa do período (coorte: pedidos faturados no período que viraram devolução `returns`) e os
 *  motivos de todo o histórico observado. Dois relógios, ditos na linha de baixo do título. */
export function DevolucoesDossie({ linha, eventos }: { linha: LinhaSku | null; eventos: Evento[] }) {
  const base = linha?.acc.pedidosBaseDevolucao ?? 0;
  const devolvidos = linha?.acc.pedidosDevolvidos ?? 0;
  const taxa = linha?.m.taxaDevolucao ?? null;
  const lista = motivos(eventos);
  const max = Math.max(1, ...lista.map((m) => m.n));

  return (
    <BlocoDossie id="dossie-devolucoes" titulo="Devoluções" relogio="Taxa no período escolhido; motivos de todo o histórico observado">
      <div className="flex flex-1 flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
        <dl className="flex flex-col-reverse">
          <dt className="text-xs text-muted-foreground">
            {base > 0 ? `${fmtInt(devolvidos)} de ${fmtInt(base)} ${base === 1 ? 'pedido' : 'pedidos'} do período viraram devolução` : 'Nenhum pedido faturado no período'}
          </dt>
          <dd className={devolvidos > 0 ? 'text-2xl font-semibold tabular-nums tracking-tight' : 'text-2xl font-semibold tabular-nums tracking-tight text-muted-foreground'}>
            {taxa == null ? NADA : pctBR(taxa)}
          </dd>
        </dl>
        <div className="flex flex-col gap-2 border-t pt-3">
          <h3 id="dossie-motivos" className="text-xs font-medium text-muted-foreground">Motivos</h3>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma devolução registrada para este código.</p>
          ) : (
            <ul aria-labelledby="dossie-motivos" className="flex flex-col gap-2">
              {lista.map(({ motivo, n }) => (
                <li key={motivo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                  <span className={motivo === SEM_MOTIVO ? 'truncate text-muted-foreground' : 'truncate'} title={motivo}>{motivo}</span>
                  <span className="tabular-nums text-muted-foreground">{fmtInt(n)}</span>
                  <span className="col-span-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-warning/70" style={{ width: `${(n / max) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </BlocoDossie>
  );
}
