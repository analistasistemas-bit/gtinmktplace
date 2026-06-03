import { useParams, useNavigate } from 'react-router-dom';
import { useLote } from '@/hooks/useLotes';
import { useFamilias } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { Button } from '@/components/ui/button';

export default function Relatorio() {
  const { loteId } = useParams<{ loteId: string }>();
  const nav = useNavigate();
  useLoteRealtime(loteId);

  const { data: lote } = useLote(loteId);
  const polling = lote?.status === 'publicando';
  const { data: familias = [] } = useFamilias(loteId, {
    refetchInterval: polling ? 2500 : undefined,
  });

  const publicadas = familias.filter((f) => f.status === 'publicado').length;
  const emPublicacao = familias.filter((f) => f.status === 'publicando').length;
  const comErro = familias.filter((f) => f.status === 'erro').length;

  if (!lote) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Relatório · Lote #{lote.numero}</h1>
      <div className="mb-6 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border bg-green-50 px-3 py-2 text-green-800">✅ {publicadas} publicada(s)</div>
        <div className="rounded-md border bg-blue-50 px-3 py-2 text-blue-800">⏳ {emPublicacao} publicando</div>
        <div className="rounded-md border bg-red-50 px-3 py-2 text-red-800">❌ {comErro} com erro</div>
      </div>
      <ul className="space-y-1 text-sm">
        {familias.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 border-b py-2">
            <span className="truncate">{f.codigoPai} — {f.titulo}</span>
            <span className="flex items-center gap-2 text-xs">
              {f.status === 'publicado' && f.mlPermalink && (
                <a href={f.mlPermalink} target="_blank" rel="noreferrer" className="text-blue-600 underline">ver anúncio ↗</a>
              )}
              {f.status === 'publicando' && <span className="text-muted-foreground">publicando…</span>}
              {f.status === 'erro' && (
                <>
                  <span className="max-w-xs truncate text-red-600" title={f.erroMensagem ?? ''}>{f.erroMensagem ?? 'erro'}</span>
                  <Button size="sm" variant="outline" onClick={() => nav(`/revisao/${loteId}`)}>Editar e tentar de novo</Button>
                </>
              )}
              {(f.status === 'pendente' || f.status === 'processando' || f.status === 'pronto') && (
                <span className="text-muted-foreground">{f.status}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
