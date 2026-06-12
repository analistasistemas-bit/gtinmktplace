import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamilias } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

export default function Relatorio() {
  const { loteId } = useParams<{ loteId: string }>();
  const nav = useNavigate();
  useLoteRealtime(loteId);

  const { data: lote } = useLote(loteId);
  // Poll enquanto houver família não-terminal. Guiar pelo status das famílias
  // (não pelo do lote) evita a tela congelar em "publicando": o lote vira
  // "concluido" ~0,8s antes do realtime entregar o status final das famílias,
  // e se esse evento se perde o polling já teria parado. Aqui o próprio polling
  // captura a transição final e só então para.
  const { data: familias = [] } = useFamilias(loteId, {
    refetchInterval: (query) => {
      const fams = query.state.data ?? [];
      const algumAtivo = fams.some(
        (f) =>
          f.status === 'pendente' ||
          f.status === 'processando' ||
          f.status === 'publicando'
      );
      return algumAtivo || lote?.status === 'publicando' ? 2500 : false;
    },
  });

  const publicadas = familias.filter((f) => f.status === 'publicado').length;
  const emPublicacao = familias.filter((f) => f.status === 'publicando').length;
  const comErro = familias.filter((f) => f.status === 'erro').length;

  if (!lote) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-6">
      <PageHeader title={`Relatório · Lote #${lote.numero}`} />
      <div className="mb-6 grid grid-cols-3 gap-3 text-sm">
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold tabular-nums">{publicadas}</span> publicada(s)</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-info">
          <Loader2 className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold tabular-nums">{emPublicacao}</span> publicando</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold tabular-nums">{comErro}</span> com erro</span>
        </div>
      </div>
      <ul className="space-y-1 text-sm">
        {familias.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 border-b py-2">
            <span className="truncate">{f.codigoPai} — {f.titulo}</span>
            <span className="flex items-center gap-2 text-xs">
              {f.status === 'publicado' && f.mlPermalink && (
                <a href={f.mlPermalink} target="_blank" rel="noreferrer" className="text-primary underline">ver anúncio ↗</a>
              )}
              {f.status === 'publicando' && <span className="text-muted-foreground">publicando…</span>}
              {f.status === 'erro' && (
                <>
                  <span className="max-w-xs truncate text-destructive" title={f.erroMensagem ?? ''}>{f.erroMensagem ?? 'erro'}</span>
                  <Button size="sm" variant="outline" onClick={() => nav(`/revisao/${loteId}`)}>Editar e tentar de novo</Button>
                </>
              )}
              {f.status === 'pronto' && (
                <span className="text-muted-foreground">não publicada (não selecionada)</span>
              )}
              {(f.status === 'pendente' || f.status === 'processando') && (
                <span className="text-muted-foreground">processando…</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
