import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamilias } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { JornadaLote } from '@/components/jornada-lote';
import { totalAnomalias } from '@/lib/tipos-dominio';

export default function Progresso() {
  const { loteId } = useParams<{ loteId: string }>();
  const nav = useNavigate();
  useLoteRealtime(loteId);

  const { data: lote } = useLote(loteId);
  // Realtime tem race condition se process-familia terminar antes da subscription
  // estabilizar (~1-2s). Polling de fallback enquanto o lote está em transito.
  const polling = lote?.status === 'processando' || lote?.status === 'importando';
  const { data: familias = [] } = useFamilias(loteId, {
    refetchInterval: polling ? 2500 : undefined,
  });

  useEffect(() => {
    if (lote?.status === 'revisao' || lote?.status === 'processando') {
      const prontas = familias.filter((f) => f.status === 'pronto').length;
      if (prontas > 0 && prontas === familias.length) {
        nav(`/revisao/${loteId}`);
      }
    }
  }, [lote, familias, loteId, nav]);

  if (!lote) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  const total = lote.totalFamilias;
  const prontas = familias.filter(
    (f) => f.status === 'pronto' || f.status === 'publicado'
  ).length;
  const erradas = familias.filter((f) => f.status === 'erro').length;
  const pct = total > 0 ? Math.round((prontas / total) * 100) : 0;

  const anomalias = lote.anomalias;
  const temAnomalias = totalAnomalias(anomalias) > 0;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={`Processando lote #${lote.numero}`}
        subtitle={`Status: ${lote.status} · ${prontas} de ${total} prontas${erradas > 0 ? ` · ${erradas} com erro` : ''}`}
      />
      <div className="mb-6">
        <JornadaLote status={lote.status} />
      </div>
      {temAnomalias && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Linhas descartadas da planilha:
            {anomalias.codigos_duplicados.length > 0 && (
              <> {anomalias.codigos_duplicados.length} código(s) duplicado(s)</>
            )}
            {anomalias.filhos_orfaos.length > 0 && (
              <> · {anomalias.filhos_orfaos.length} variação(ões) órfã(s)</>
            )}
            {anomalias.familias_sem_filho.length > 0 && (
              <> · {anomalias.familias_sem_filho.length} família(s) sem variação</>
            )}
          </span>
        </div>
      )}
      <Progress value={pct} className="h-2" />
      <ul className="mt-6 space-y-1 text-sm">
        {familias.map((f) => (
          <li key={f.id} className="flex justify-between border-b py-1">
            <span>
              {f.codigoPai} — {f.titulo}
            </span>
            <span className="text-xs text-muted-foreground">{f.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
