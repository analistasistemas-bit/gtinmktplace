import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { BotaoExcluirLote } from '@/components/botao-excluir-lote';
import { StatusBadge } from '@/components/status-badge';
import { destinoDoLote } from '@/lib/jornada';
import type { Lote } from '@/lib/tipos-dominio';

function formatarData(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoteCard({ lote }: { lote: Lote }) {
  return (
    <>
      <Link to={destinoDoLote(lote.status, lote.id)} className="block">
        <Card className="relative border border-border p-4 shadow-none ring-0 transition-colors hover:border-primary/40 hover:bg-accent hover:shadow-none">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-0">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">Lote #{lote.numero}</h3>
                <StatusBadge
                  status={lote.status}
                  resultado={{ publicadas: lote.totalPublicadas, erros: lote.totalErros }}
                />
                {/* E6b: numa org que usa os dois fluxos, "Lote #12" sozinho não diz de onde veio. */}
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                  {lote.origem === 'manual' ? 'Cadastro manual' : 'Planilha'}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{formatarData(lote.criadoEm)}</p>
            </div>
            <div className="flex items-start gap-2">
              <div className="text-right text-sm text-muted-foreground">
                <div>{lote.totalFamilias} famílias</div>
                {lote.status === 'concluido' && (
                  <div className="text-xs">
                    {lote.totalPublicadas} publicadas · {lote.totalErros}{' '}
                    {lote.totalErros === 1 ? 'erro' : 'erros'}
                  </div>
                )}
              </div>
              <BotaoExcluirLote lote={lote} />
            </div>
          </div>
        </Card>
      </Link>
    </>
  );
}
