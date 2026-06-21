import { useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  PackageOpen,
  Package,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { LoteCard } from '@/components/lote-card';
import { LotesEmAndamento } from '@/components/dashboard-lotes-andamento';
import { useLotes } from '@/hooks/useLotes';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { usePaginacao } from '@/hooks/usePaginacao';
import { Pagination } from '@/components/ui/pagination';
import { calcularKpisDashboard } from '@/lib/dashboard-kpis';

export default function Dashboard() {
  const { data: lotes = [], isLoading, error } = useLotes();
  const { data: publicados = [] } = usePublicados();
  const { data: statusData, isLoading: loadingStatus, isError: erroStatus } = useStatusPublicados();

  const statusItens = statusData?.itens ?? [];
  // Cards ao vivo indisponíveis quando a conta ML não está conectada OU a chamada falhou.
  const semStatus = (statusData?.semCredencialML ?? false) || erroStatus;
  const kpis = calcularKpisDashboard(lotes, publicados, statusItens);
  const pag = usePaginacao(lotes);
  const topoRef = useRef<HTMLDivElement>(null);

  const irPara = (p: number) => {
    pag.irPara(p);
    topoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const novoLoteBtn = (
    <Button asChild>
      <Link to="/novo-lote">
        <Plus className="mr-1 h-4 w-4" />
        Novo lote
      </Link>
    </Button>
  );

  return (
    <div className="p-6">
      <PageHeader title="Dashboard" actions={novoLoteBtn} />

      <LotesEmAndamento lotes={lotes} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Anúncios publicados" value={kpis.publicados} icon={Package} variant="brand" />
        <KpiCard
          label="Ativos"
          value={semStatus ? '—' : kpis.ativos}
          icon={CheckCircle2}
          loading={loadingStatus}
          hint={semStatus ? 'ML indisponível' : undefined}
        />
        <KpiCard
          label="Com problema"
          value={semStatus ? '—' : kpis.comProblema}
          icon={AlertTriangle}
          loading={loadingStatus}
          hint={semStatus ? 'ML indisponível' : undefined}
        />
        <KpiCard label="Erros de publicação" value={kpis.erros} icon={XCircle} />
        <KpiCard label="A revisar" value={kpis.aRevisar} icon={ClipboardList} />
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando lotes...</div>
      ) : error ? (
        <div className="text-sm text-destructive">
          Erro ao carregar lotes: {(error as Error).message}
        </div>
      ) : lotes.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Nenhum lote ainda"
          description='Faça upload de uma planilha para começar. Clique em "Novo lote".'
          action={novoLoteBtn}
        />
      ) : (
        <div ref={topoRef} className="flex flex-col gap-3 scroll-mt-6">
          {pag.itensPagina.map((lote) => (
            <LoteCard key={lote.id} lote={lote} />
          ))}
          <Pagination
            rotuloItem="lote"
            paginaAtual={pag.paginaAtual}
            totalPaginas={pag.totalPaginas}
            inicio={pag.inicio}
            fim={pag.fim}
            total={pag.total}
            tamanho={pag.tamanho}
            onIrPara={irPara}
            onTamanho={pag.setTamanho}
          />
        </div>
      )}
    </div>
  );
}
