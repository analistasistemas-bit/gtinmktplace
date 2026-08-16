// Pulse (ADR-0119): radar dirigido de concorrência — preços e vendedores dos produtos de
// catálogo dos nossos anúncios, com price-to-win e simulador de margem.
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TabelaRadar } from '@/components/pulse/tabela-radar';
import { DialogDetalhe } from '@/components/pulse/dialog-detalhe';
import { DialogAdicionar } from '@/components/pulse/dialog-adicionar';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { QK } from '@/lib/queries';
import { fetchPulseProdutos, coletarPulseAgora } from '@/lib/pulse';
import { cn } from '@/lib/utils';

export default function Pulse() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const qc = useQueryClient();
  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const { data: produtos, isLoading } = useQuery({
    queryKey: QK.pulseProdutos,
    queryFn: fetchPulseProdutos,
    enabled: !!modulos?.includes('pulse'),
    staleTime: 60_000,
  });

  const atualizar = useMutation({
    mutationFn: coletarPulseAgora,
    onSuccess: (r) => {
      toast.success(`✓ Radar atualizado — ${r.produtos} produto(s), ${r.alertas} alerta(s) novo(s)`);
      // Prefixo: também alcança o resumo de ofertas (menor preço/nº de ofertas) e qualquer
      // detalhe/contexto de margem abertos — todos derivam do que o coletor acabou de gravar.
      qc.invalidateQueries({ queryKey: ['pulse'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (modulosLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!modulos?.includes('pulse')) return <Navigate to="/" replace />;

  const lista = produtos ?? [];
  const produtoDetalhe = lista.find((p) => p.id === detalheId) ?? null;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Pulse"
        subtitle="Radar de concorrência dos seus produtos de catálogo, com alertas e price-to-win."
        actions={
          <>
            <Button variant="outline" onClick={() => atualizar.mutate()} disabled={atualizar.isPending}>
              <RefreshCw className={cn('mr-2 h-4 w-4', atualizar.isPending && 'animate-spin')} />
              Atualizar agora
            </Button>
            <Button onClick={() => setAdicionarAberto(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar produto
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nenhum produto no radar ainda."
          description="O radar acompanha automaticamente os concorrentes dos seus anúncios de catálogo. Publique anúncios ou adicione um produto manualmente."
          action={<Button onClick={() => setAdicionarAberto(true)}>Adicionar produto</Button>}
        />
      ) : (
        <TabelaRadar produtos={lista} onAbrirDetalhe={setDetalheId} />
      )}

      <DialogAdicionar aberto={adicionarAberto} onFechar={() => setAdicionarAberto(false)} />
      <DialogDetalhe produto={produtoDetalhe} onFechar={() => setDetalheId(null)} />
    </div>
  );
}
