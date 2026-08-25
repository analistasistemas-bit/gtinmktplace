// Pulse (ADR-0133): a aba de alertas. Abre em "Ação" — os alertas que mudam decisão de preço.
// Informativo fica a um clique, e nunca disputa a mesma lista.
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { QK } from '@/lib/queries';
import {
  ALERTAS_POR_PAGINA, contarPulseAlertas, fetchPulseAlertas, marcarAlertaLido, marcarAlertasLidos,
  type FiltroSeveridade, type PulseAlerta,
} from '@/lib/pulse';
import { textoAlerta } from '@/lib/pulse-alerta-texto';

export function AbaAlertas({
  onVerProduto, onReprecificar, onVerRadar,
}: {
  onVerProduto: (produtoId: string) => void;
  onReprecificar: (alerta: PulseAlerta) => void;
  onVerRadar: () => void;
}) {
  const qc = useQueryClient();
  const [severidade, setSeveridade] = useState<FiltroSeveridade>('acao');

  const { data: contagem } = useQuery({
    queryKey: QK.pulseAlertasContagem(severidade),
    queryFn: () => contarPulseAlertas(severidade),
  });
  // Necessária mesmo fora do filtro Informativo: é o número que o estado vazio de Ação oferece
  // como próximo passo ("Ver informativos (N)").
  const { data: contagemInfo } = useQuery({
    queryKey: QK.pulseAlertasContagem('info'),
    queryFn: () => contarPulseAlertas('info'),
  });

  const {
    data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: QK.pulseAlertas(severidade, 0),
    queryFn: ({ pageParam }) => fetchPulseAlertas({ severidade, pagina: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => (ultima.length < ALERTAS_POR_PAGINA ? undefined : todas.length),
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ['pulse', 'alertas'] });

  const marcarLido = useMutation({
    mutationFn: marcarAlertaLido,
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidar,
  });

  const lista = useMemo(() => (data?.pages ?? []).flat(), [data]);

  // Teto do "marcar todos": o alerta mais novo já carregado. A lista vem em ordem decrescente, então
  // é o primeiro item. Sem isso, um alerta gravado pelo coletor entre a contagem e o clique seria
  // marcado como lido sem nunca ter sido renderizado.
  const maisNovoVisto = lista[0]?.criado_em ?? null;

  const marcarTodosLidos = useMutation({
    mutationFn: (ateCriadoEm: string) => marcarAlertasLidos(severidade, ateCriadoEm),
    onError: (e: Error) => toast.error(e.message),
    onSettled: invalidar,
  });

  // Consulta quebrada não pode parecer "nenhum alerta" — é a primeira pergunta que a tela responde.
  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
        Não foi possível carregar os alertas.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={severidade} onValueChange={(v) => setSeveridade(v as FiltroSeveridade)}>
          <TabsList aria-label="Filtrar alertas por severidade">
            <TabsTrigger value="acao">Ação</TabsTrigger>
            <TabsTrigger value="info">Informativo</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={() => maisNovoVisto && marcarTodosLidos.mutate(maisNovoVisto)}
          disabled={!contagem || !maisNovoVisto || marcarTodosLidos.isPending}
        >
          Marcar {contagem ?? 0} como lidos
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : lista.length === 0 ? (
        severidade === 'acao' ? (
          <EmptyState
            icon={Bell}
            title="Nenhum alerta exige decisão agora"
            description="Movimentos de mercado sem decisão ficam em Informativo."
            action={
              <div className="flex flex-col items-center gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => setSeveridade('info')}>
                  Ver informativos ({contagemInfo ?? 0})
                </Button>
                <Button variant="ghost" onClick={onVerRadar}>
                  Ver mais caros no Radar
                </Button>
              </div>
            }
          />
        ) : (
          <EmptyState icon={Bell} title="Nenhum alerta pendente." />
        )
      ) : (
        <div className="flex flex-col gap-0 rounded-lg border">
          {lista.map((alerta) => (
            <div
              key={alerta.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm last:border-0"
            >
              <span className="min-w-0 flex-1 truncate" title={textoAlerta(alerta)}>{textoAlerta(alerta)}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                {alerta.produto_id && (
                  <Button variant="outline" size="sm" onClick={() => onVerProduto(alerta.produto_id!)}>
                    Ver produto
                  </Button>
                )}
                {alerta.tipo === 'preco_caiu' && alerta.pulse_produtos?.codigo_pai && (
                  <Button variant="outline" size="sm" onClick={() => onReprecificar(alerta)}>
                    Reprecificar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 sm:h-7 sm:w-7"
                  aria-label="Marcar como lido"
                  onClick={() => marcarLido.mutate(alerta.id)}
                  // Só o alerta em voo desabilita — a mutation é compartilhada e congelava a lista toda.
                  disabled={marcarLido.isPending && marcarLido.variables === alerta.id}
                >
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {hasNextPage && (
            <div className="flex justify-center border-t p-2">
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                Carregar mais
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
