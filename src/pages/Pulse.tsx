// Pulse (ADR-0119): radar dirigido de concorrência — preços e vendedores dos produtos de
// catálogo dos nossos anúncios, com price-to-win e simulador de margem.
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Bell, Plus, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { posicaoVsMercado } from '@/lib/pulse-formato';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TabelaRadar } from '@/components/pulse/tabela-radar';
import { DialogDetalhe } from '@/components/pulse/dialog-detalhe';
import { DialogAdicionar } from '@/components/pulse/dialog-adicionar';
import { PainelAlertas } from '@/components/pulse/painel-alertas';
import { DialogReprecificar } from '@/components/pulse/dialog-reprecificar';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { QK } from '@/lib/queries';
import { fetchPulseProdutos, fetchPulseResumoOfertas, coletarPulseAgora, type PulseAlerta } from '@/lib/pulse';
import { cn } from '@/lib/utils';

export default function Pulse() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const qc = useQueryClient();
  const [adicionarAberto, setAdicionarAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [alertaReprecificar, setAlertaReprecificar] = useState<PulseAlerta | null>(null);
  const [busca, setBusca] = useState('');

  const { data: produtos, isLoading, isError, error, refetch } = useQuery({
    queryKey: QK.pulseProdutos,
    queryFn: fetchPulseProdutos,
    enabled: !!modulos?.includes('pulse'),
    staleTime: 60_000,
  });

  // Uma única query de ofertas para a página inteira: KPIs e tabela leem o mesmo Map. A chave usa
  // os ids de TODOS os produtos (não os filtrados pela busca), senão cada tecla digitada criaria
  // uma entrada de cache nova e as colunas de mercado piscariam para "—".
  const ids = (produtos ?? []).map((p) => p.id);
  const { data: resumoOfertas, isLoading: resumoCarregando } = useQuery({
    queryKey: ['pulse', 'ofertas-resumo', ids],
    queryFn: () => fetchPulseResumoOfertas(ids),
    enabled: ids.length > 0,
  });

  // Os três números que respondem "tenho trabalho hoje?" — derivados do que já está carregado.
  const resumoPosicao = useMemo(() => {
    let maisCaro = 0, maisBarato = 0, comparaveis = 0, semVinculo = 0;
    for (const p of produtos ?? []) {
      if (p.catalogo_status && p.catalogo_status !== 'vinculado') semVinculo++;
      const pos = posicaoVsMercado(p.meu_preco, resumoOfertas?.get(p.id)?.menorPreco ?? null);
      if (!pos) continue;
      comparaveis++;
      if (pos.deltaPct > 0.5) maisCaro++;
      else if (pos.deltaPct < -0.5) maisBarato++;
    }
    return { maisCaro, maisBarato, comparaveis, semVinculo };
  }, [produtos, resumoOfertas]);

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
  const filtrada = busca.trim()
    ? lista.filter((p) => {
        const t = busca.trim().toLowerCase();
        return (p.titulo ?? '').toLowerCase().includes(t)
          || (p.gtin ?? '').includes(t)
          || (p.codigo_pai ?? '').includes(t);
      })
    : lista;

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

      <PainelAlertas onVerProduto={setDetalheId} onReprecificar={setAlertaReprecificar} />

      {lista.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard size="compact" label="No radar" value={lista.length} icon={Activity} tom="info" />
          <KpiCard
            size="compact"
            label="Mais caro que o mercado"
            value={resumoPosicao.maisCaro}
            icon={TrendingUp}
            tom={resumoPosicao.maisCaro > 0 ? 'warning' : 'success'}
            hint={resumoPosicao.comparaveis > 0 ? `de ${resumoPosicao.comparaveis} comparáveis` : 'sem comparação ainda'}
          />
          <KpiCard size="compact" label="Você é o menor preço" value={resumoPosicao.maisBarato} icon={TrendingUp} tom="success" />
          <KpiCard
            size="compact"
            label="Sem vínculo de catálogo"
            value={resumoPosicao.semVinculo}
            icon={Bell}
            tom={resumoPosicao.semVinculo > 0 ? 'warning' : 'info'}
            hint={resumoPosicao.semVinculo > 0 ? 'não disputam a página' : undefined}
          />
        </div>
      )}

      {lista.length > 3 && (
        <div className="relative mb-3 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou EAN"
            aria-label="Buscar produto no radar"
            className="h-9 pl-8"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        // Falha de leitura não pode se disfarçar de "radar vazio" — o operador leria "sem
        // concorrência nova" quando na verdade a consulta caiu.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Não foi possível carregar o radar.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido ao consultar os produtos.'}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nenhum produto no radar ainda."
          description="O radar acompanha automaticamente os concorrentes dos seus anúncios de catálogo. Publique anúncios ou adicione um produto manualmente."
          action={<Button onClick={() => setAdicionarAberto(true)}>Adicionar produto</Button>}
        />
      ) : filtrada.length === 0 ? (
        <EmptyState
          icon={Search}
          title={`Nenhum produto para “${busca}”.`}
          description="Busque pelo nome do produto ou pelo EAN exibido sob ele."
          action={<Button variant="outline" onClick={() => setBusca('')}>Limpar busca</Button>}
        />
      ) : (
        <TabelaRadar
          produtos={filtrada}
          resumo={resumoOfertas}
          resumoCarregando={resumoCarregando}
          onAbrirDetalhe={setDetalheId}
        />
      )}

      <DialogAdicionar aberto={adicionarAberto} onFechar={() => setAdicionarAberto(false)} />
      <DialogDetalhe produto={produtoDetalhe} onFechar={() => setDetalheId(null)} />
      <DialogReprecificar
        codigoPai={alertaReprecificar?.pulse_produtos?.codigo_pai ?? null}
        precoInicial={alertaReprecificar ? Number(alertaReprecificar.payload.para) : null}
        ptwCustos={lista.find((p) => p.id === alertaReprecificar?.produto_id)?.ptw_custos ?? null}
        onFechar={() => setAlertaReprecificar(null)}
      />
    </div>
  );
}
