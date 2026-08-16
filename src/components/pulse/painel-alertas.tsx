// Pulse (ADR-0119): painel de alertas não lidos no topo do radar — queda de preço, novo
// concorrente, concorrente saiu. Reprecificar só existe para preco_caiu de produto nosso
// (codigo_pai presente); os demais alertas só têm "Ver produto" e "marcar lido".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QK } from '@/lib/queries';
import { fetchPulseAlertas, marcarAlertaLido, type PulseAlerta } from '@/lib/pulse';
import { textoAlerta } from '@/lib/pulse-alerta-texto';

export function PainelAlertas({
  onVerProduto, onReprecificar,
}: {
  onVerProduto: (produtoId: string) => void;
  onReprecificar: (alerta: PulseAlerta) => void;
}) {
  const qc = useQueryClient();
  const { data: alertas } = useQuery({ queryKey: QK.pulseAlertas, queryFn: fetchPulseAlertas, staleTime: 30_000 });

  const marcarLido = useMutation({
    mutationFn: marcarAlertaLido,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: QK.pulseAlertas });
      const anterior = qc.getQueryData<PulseAlerta[]>(QK.pulseAlertas);
      qc.setQueryData<PulseAlerta[]>(QK.pulseAlertas, (atual) => (atual ?? []).filter((a) => a.id !== id));
      return { anterior };
    },
    onError: (e: Error, _id, contexto) => {
      if (contexto?.anterior) qc.setQueryData(QK.pulseAlertas, contexto.anterior);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QK.pulseAlertas }),
  });

  const lista = alertas ?? [];
  if (lista.length === 0) return null;

  return (
    <Card className="mb-4 border-warning/30 bg-warning/10">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-warning">
          <Bell className="h-4 w-4" />
          {lista.length === 1 ? '1 alerta novo' : `${lista.length} alertas novos`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 pt-0">
        {lista.map((alerta) => (
          <div
            key={alerta.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-warning/20 py-2 text-sm first:border-0"
          >
            <span>{textoAlerta(alerta)}</span>
            <div className="ml-auto flex items-center gap-1.5">
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
                disabled={marcarLido.isPending}
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
