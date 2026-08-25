// Pulse (ADR-0119): painel de alertas não lidos no topo do radar — queda de preço, novo
// concorrente, concorrente saiu. Reprecificar só existe para preco_caiu de produto nosso
// (codigo_pai presente); os demais alertas só têm "Ver produto" e "marcar lido".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QK } from '@/lib/queries';
import { fetchPulseAlertas, marcarAlertaLido, marcarAlertasLidos, type PulseAlerta } from '@/lib/pulse';
import { textoAlerta } from '@/lib/pulse-alerta-texto';

// ponytail: painel-alertas será removido na Task 4 (substituído pela aba Alertas do ADR-0133).
// Chave/filtro fixados em 'todos'/página 0 só para manter este arquivo compilando até lá.
const CHAVE_ALERTAS = QK.pulseAlertas('todos', 0);

export function PainelAlertas({
  onVerProduto, onReprecificar,
}: {
  onVerProduto: (produtoId: string) => void;
  onReprecificar: (alerta: PulseAlerta) => void;
}) {
  const qc = useQueryClient();
  const { data: alertas, isError } = useQuery({
    queryKey: CHAVE_ALERTAS,
    queryFn: () => fetchPulseAlertas({ severidade: 'todos', pagina: 0 }),
    staleTime: 30_000,
  });

  const marcarLido = useMutation({
    mutationFn: marcarAlertaLido,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: CHAVE_ALERTAS });
      const anterior = qc.getQueryData<PulseAlerta[]>(CHAVE_ALERTAS);
      qc.setQueryData<PulseAlerta[]>(CHAVE_ALERTAS, (atual) => (atual ?? []).filter((a) => a.id !== id));
      return { anterior };
    },
    onError: (e: Error, _id, contexto) => {
      if (contexto?.anterior) qc.setQueryData(CHAVE_ALERTAS, contexto.anterior);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE_ALERTAS }),
  });

  const limparTodos = useMutation({
    mutationFn: () => marcarAlertasLidos('todos'),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: CHAVE_ALERTAS });
      const anterior = qc.getQueryData<PulseAlerta[]>(CHAVE_ALERTAS);
      qc.setQueryData<PulseAlerta[]>(CHAVE_ALERTAS, []);
      return { anterior };
    },
    onError: (e: Error, _vars, contexto) => {
      if (contexto?.anterior) qc.setQueryData(CHAVE_ALERTAS, contexto.anterior);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: CHAVE_ALERTAS }),
  });

  // Consulta quebrada não pode parecer "nenhum alerta" — é a primeira pergunta que a tela responde.
  if (isError) {
    return (
      <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
        Não foi possível carregar os alertas. Os números abaixo continuam válidos.
      </div>
    );
  }

  const lista = alertas ?? [];
  if (lista.length === 0) return null;

  return (
    <Card className="mb-4 border-warning/30 bg-warning/10 py-0">
      <CardHeader className="px-4 pb-0 pt-3">
        <CardTitle className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warning">
          <Bell className="h-3.5 w-3.5" />
          {lista.length === 1 ? '1 alerta novo' : `${lista.length} alertas novos`}
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => limparTodos.mutate()}
            disabled={limparTodos.isPending}
          >
            Limpar todos
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 px-4 pb-2 pt-1">
        {lista.map((alerta) => (
          <div
            key={alerta.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-warning/20 py-1.5 text-sm first:border-0"
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
                size="sm"
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
      </CardContent>
    </Card>
  );
}
