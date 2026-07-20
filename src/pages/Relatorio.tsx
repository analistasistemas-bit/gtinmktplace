import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useLote } from '@/hooks/useLotes';
import { useFamiliasResumo } from '@/hooks/useFamilias';
import { useLoteRealtime } from '@/hooks/useLoteRealtime';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Progress } from '@/components/ui/progress';
import { JornadaLote } from '@/components/jornada-lote';

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
  const { data: familias = [] } = useFamiliasResumo(loteId, {
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

  // Famílias que entraram na publicação (selecionadas) = publicado + publicando + erro.
  // A barra avança conforme cada uma termina (sucesso OU erro). Guiada pelo status das
  // famílias + do lote para não sumir no intervalo em que o lote já virou 'concluido'
  // mas ainda restam famílias 'publicando' (ver comentário do refetchInterval acima).
  const totalPublicacao = publicadas + emPublicacao + comErro;
  const processadas = publicadas + comErro;
  const publicando = lote.status === 'publicando' || emPublicacao > 0;
  const pctPublicacao = totalPublicacao > 0 ? Math.round((processadas / totalPublicacao) * 100) : 0;

  return (
    <div className="p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Dashboard', to: '/' }, { label: `Lote #${lote.numero}` }]} />
      <PageHeader title={`Relatório · Lote #${lote.numero}`} />
      <div className="mb-6">
        <JornadaLote status={lote.status} />
      </div>
      {publicando && (
        <div className="mb-6 space-y-2 rounded-lg border border-info/30 bg-info/5 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium text-info">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Publicando no Mercado Livre…
            </span>
            <span className="tabular-nums text-muted-foreground">
              {processadas} de {totalPublicacao} ({pctPublicacao}%)
            </span>
          </div>
          <Progress value={pctPublicacao} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Não feche esta tela — o status de cada família atualiza automaticamente.
          </p>
        </div>
      )}
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
              {f.status === 'publicado' && (
                f.anuncios.length > 1 ? (
                  // Split (ADR-0048): produto em N anúncios → um link por partição.
                  f.anuncios.map((a, i) => a.permalink && (
                    <a key={a.particao} href={a.permalink} target="_blank" rel="noreferrer"
                       title={a.titulo ?? ''} className="text-primary underline">ver anúncio {i + 1} ↗</a>
                  ))
                ) : f.mlPermalink ? (
                  <a href={f.mlPermalink} target="_blank" rel="noreferrer" className="text-primary underline">ver anúncio ↗</a>
                ) : null
              )}
              {f.status === 'publicando' && (
                <span className="flex items-center gap-1.5 text-info">
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />publicando…
                </span>
              )}
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
