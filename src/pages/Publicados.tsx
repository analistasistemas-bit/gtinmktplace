import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RefreshCw, ExternalLink, Trash2, Pause, Play, PackageOpen, ArrowUp, ArrowDown, ChevronsUpDown, Wallet, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import { filtrarPublicados, ordenarPublicados, rotuloTipo } from '@/lib/publicados';
import { CanalTabs } from '@/components/canal-tabs';
import { CanalBadge } from '@/components/canal-badge';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { traduzirMotivoModeracao } from '@/lib/moderacao';
import type { PublicadoItem, StatusPublicado, FiltroPublicados, ColunaOrdenavel, OrdenacaoPublicados } from '@/lib/publicados';
import { resolverJanela, type Periodo } from '@/lib/metricas';
import { DashboardPublicados } from '@/components/dashboard-publicados';
import { PainelAnalise } from '@/components/painel-analise';
import { fetchFamiliaPublicada } from '@/lib/queries';
import { resumoViabilidade, type ResumoViabilidade } from '@/lib/analise-viabilidade';
import { BotaoExportar } from '@/components/export/botao-exportar';
import { buildPublicadosReport } from '@/lib/export/adapters';
import type { ExportConfig, ReportData } from '@/lib/export';
import { useSessionState } from '@/hooks/useSessionState';
import { useFamilia } from '@/hooks/useFamilia';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { calcularResumo } from '@/lib/resumo-vendas';
import { montarCustoResolver, montarPesoResolver, montarAliquotaResolver } from '@/lib/custos';
import { useRemoverPublicado } from '@/hooks/useRemoverPublicado';
import { usePausarReativarPublicado } from '@/hooks/usePausarReativarPublicado';
import { useProfile } from '@/hooks/useProfile';
import { paginar } from '@/lib/paginacao';
import { paramsParaEstado, estadoParaParams, type EstadoPublicados } from '@/lib/publicados-url';
import { FiltrosAtivos, type ChaveFiltro } from '@/components/filtros-ativos';
import { Pagination } from '@/components/ui/pagination';

// ============================================================================
// Badge de status
// ============================================================================

const STATUS_LABEL: Record<StatusPublicado, string> = {
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
  moderado: 'Moderado',
  inativo: 'Inativo',
  indisponivel: 'Indisponível',
};

const STATUS_TONE: Record<StatusPublicado, StatusTone> = {
  ativo: 'success',
  pausado: 'neutral',
  encerrado: 'neutral',
  moderado: 'warning',
  inativo: 'danger',
  indisponivel: 'neutral',
};

function BadgeStatus({ status, motivo }: { status: StatusPublicado; motivo?: string | null }) {
  return (
    <span className="flex flex-col gap-0.5">
      <StatusPill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusPill>
      {status === 'moderado' && motivo && (
        <span className="text-xs text-warning">{traduzirMotivoModeracao(motivo)}</span>
      )}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

// ============================================================================
// Linha da tabela
// ============================================================================

interface LinhaProps {
  item: PublicadoItem;
  onRemover: (familiaId: string) => void;
  removendo: boolean;
  onPausarReativar: (mlItemId: string, novoStatus: 'ativo' | 'pausado') => void;
  pausando: boolean;
  isAdmin: boolean;
}

const CONTEUDO_ML = (
  <>
    <ExternalLink className="mr-1 h-3 w-3" />
    ML
  </>
);

const SELO_MODO: Record<'classico' | 'premium', { label: string; cls: string }> = {
  classico: { label: 'Clássico', cls: 'border-border bg-muted text-muted-foreground' },
  premium: { label: 'Premium', cls: 'border-primary/30 bg-primary/10 text-primary' },
};

function SeloModo({ listingType }: { listingType?: 'classico' | 'premium' | null }) {
  if (!listingType) return null;
  const s = SELO_MODO[listingType];
  return (
    <span className={cn('inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold', s.cls)}>
      {s.label}
    </span>
  );
}

function LinhaTabela({ item, onRemover, removendo, onPausarReativar, pausando, isAdmin }: LinhaProps) {
  // Expansão persistida (sobrevive a ordenar/filtrar/paginar, que remonta a linha), como o sort.
  const [aberto, setAberto] = useSessionState(`expand:publicados:${item.familiaId}`, false);
  const { data: familia, isLoading: carregandoFamilia, isError: erroFamilia } = useFamilia(item.familiaId, aberto);

  // Toggle só faz sentido entre ativo⇄pausado (ADR-0060). Moderado/encerrado/etc. ficam desabilitados.
  const podeAlternar = item.status === 'ativo' || item.status === 'pausado';
  const motivoDesabilitado = !isAdmin
    ? 'Somente administradores podem pausar/reativar anúncios'
    : !podeAlternar
      ? 'Não é possível alternar o status deste anúncio'
      : undefined;

  return (
    <>
    <TableRow
      onClick={() => setAberto((a) => !a)}
      className={cn('cursor-pointer', aberto && 'border-b-0 bg-muted/20')}
    >
      <TableCell className="whitespace-normal sticky left-0 z-10 bg-background sm:static sm:z-auto sm:bg-transparent">
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setAberto((a) => !a); }}
            aria-expanded={aberto}
            aria-label={aberto ? 'Recolher análise' : 'Expandir análise'}
            className="mt-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className={cn('h-4 w-4 motion-safe:transition-transform duration-(--motion-duration-state) ease-reversible', aberto && 'rotate-90')} />
          </button>
          <div className="max-w-[260px]">
            <p className="text-sm font-medium uppercase break-words">{item.titulo}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.codigoPai}</p>
            <CanalBadge canal={item.canal ?? 'mercado_livre'} className="mt-1" />
          </div>
        </div>
      </TableCell>
      <TableCell className="text-sm tabular-nums">{item.precoPublicacao > 0 ? fmtBRL(item.precoPublicacao) : '—'}</TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.estoque != null ? item.estoque : '—'}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.precoAtual != null ? fmtBRL(item.precoAtual) : '—'}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.unidadesVendidas != null ? item.unidadesVendidas : '—'}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.valorVendido != null && item.valorVendido > 0 ? fmtBRL(item.valorVendido) : '—'}
      </TableCell>
      <TableCell>
        <BadgeStatus status={item.status ?? 'indisponivel'} motivo={item.motivo} />
      </TableCell>
      <TableCell className="text-sm">{fmtData(item.publicadoEm)}</TableCell>
      <TableCell className="relative">
        <div className="absolute right-2 top-0">
          <SeloModo listingType={item.listingType} />
        </div>
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            disabled={!item.mlPermalink}
            className="h-7 px-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {item.mlPermalink ? (
              <a href={item.mlPermalink} target="_blank" rel="noreferrer">{CONTEUDO_ML}</a>
            ) : (
              <span>{CONTEUDO_ML}</span>
            )}
          </Button>

          {item.status === 'pausado' ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Reativar"
              title={motivoDesabilitado ?? 'Reativar'}
              className="h-7 px-2 text-xs"
              disabled={!isAdmin || !podeAlternar || pausando}
              onClick={(e) => { e.stopPropagation(); onPausarReativar(item.mlItemId, 'ativo'); }}
            >
              <Play className="h-3 w-3" />
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Pausar"
                  title={motivoDesabilitado ?? 'Pausar'}
                  className="h-7 px-2 text-xs"
                  disabled={!isAdmin || !podeAlternar || pausando}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Pause className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Pausar anúncio?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O anúncio deixa de aparecer na busca e não pode mais ser comprado no
                    Mercado Livre até você reativar. Ele continua nesta tela — o vínculo
                    local de UPDATE não é afetado.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onPausarReativar(item.mlItemId, 'pausado')}>
                    Pausar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remover"
                title="Remover"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                disabled={removendo}
                onClick={(e) => e.stopPropagation()}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover do sistema?</AlertDialogTitle>
                <AlertDialogDescription>
                  Você perde o vínculo de UPDATE para <strong>TODAS</strong> as futuras planilhas
                  com o código <code className="rounded bg-muted px-1">{item.codigoPai}</code>,
                  não só deste lote. O anúncio no ML continua ativo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onRemover(item.familiaId)}
                >
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
    {aberto && (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={9} className="whitespace-normal bg-muted/30 p-3">
          {carregandoFamilia ? (
            <p className="text-xs text-muted-foreground">carregando análise…</p>
          ) : erroFamilia || !familia ? (
            <p className="text-xs text-muted-foreground">não foi possível carregar a análise deste item.</p>
          ) : (
            <PainelAnalise
              familia={familia}
              precoOverride={item.precoAtual ?? item.precoPublicacao}
              listingTypeReal={item.listingType ?? null}
            />
          )}
        </TableCell>
      </TableRow>
    )}
    </>
  );
}

// ============================================================================
// Cabeçalho ordenável
// ============================================================================

interface ThOrdenavelProps {
  coluna: ColunaOrdenavel;
  label: string;
  ord: OrdenacaoPublicados | null;
  onOrdenar: (coluna: ColunaOrdenavel) => void;
  className?: string;
}

function ThOrdenavel({ coluna, label, ord, onOrdenar, className }: ThOrdenavelProps) {
  const ativo = ord?.coluna === coluna;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onOrdenar(coluna)}
        className={cn(
          'flex items-center gap-1 transition-colors hover:text-foreground',
          ativo && 'text-foreground',
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        {!ativo ? (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        ) : ord!.dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
      </button>
    </TableHead>
  );
}

// ============================================================================
// Página principal
// ============================================================================

export default function Publicados() {
  const { data: publicados = [], isLoading: loadingPublicados, error: erroPublicados } = usePublicados();
  const { data: statusData, isFetching: fetchingStatus, refetch: refetchStatus } = useStatusPublicados();
  const { mutate: remover, isPending: removendo, error: erroRemover } = useRemoverPublicado();
  const { mutate: pausarReativar, isPending: pausandoOuReativando, error: erroPausar } = usePausarReativarPublicado();
  const { isAdmin } = useProfile();
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();

  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  // Fonte única dos KPIs: tabela ml_vendas (ADR-0038) — mesmo número que Faturamento e Financeiro.
  const { data: vendas, isFetching: fetchingMetricas, error: erroVendas, refetch: refetchMetricas } = useVendas(janela, 'todos', canalAtivo);
  const { data: custos } = useCustos();
  const { data: aliquotas } = useAliquotas();
  const resumo = useMemo(
    () => calcularResumo(
      vendas ?? [],
      montarCustoResolver(custos),
      montarPesoResolver(custos),
      undefined,
      montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 }),
    ),
    [vendas, custos, aliquotas],
  );
  const markupPct = resumo.markup;

  // Estado da tela (filtro/ordenação/página/tamanho) vive na URL: ao abrir um
  // detalhe e voltar (back), o navegador restaura tudo. Setters usam replace para
  // não empilhar histórico a cada tecla. Mudar filtro/ordenação volta à página 1.
  const [searchParams, setSearchParams] = useSearchParams();
  const { filtro, ord, pagina, tamanho } = useMemo(() => paramsParaEstado(searchParams), [searchParams]);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [pausandoId, setPausandoId] = useState<string | null>(null);

  const aplicar = useCallback(
    (mudanca: (atual: EstadoPublicados) => Partial<EstadoPublicados>) => {
      setSearchParams(
        (prev) => {
          const atual = paramsParaEstado(prev);
          return estadoParaParams({ ...atual, ...mudanca(atual) });
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setFiltro = useCallback(
    (updater: (f: FiltroPublicados) => FiltroPublicados) =>
      aplicar((a) => ({ filtro: updater(a.filtro), pagina: 1 })),
    [aplicar],
  );

  // Clicar na coluna alterna só entre A→Z e Z→A. Coluna nova começa em asc (A→Z).
  const ordenarPor = (coluna: ColunaOrdenavel) =>
    aplicar((a) => ({
      ord:
        a.ord?.coluna === coluna
          ? { coluna, dir: a.ord.dir === 'asc' ? 'desc' : 'asc' }
          : { coluna, dir: 'asc' },
      pagina: 1,
    }));

  // Desabilita só a linha em remoção (não todas).
  const handleRemover = (familiaId: string) => {
    setRemovendoId(familiaId);
    remover(familiaId, {
      onSuccess: () => toast.success('Removido do sistema'),
      onError: (err) =>
        toast.error('Falha ao remover', {
          description: err instanceof Error ? err.message : String(err),
        }),
      onSettled: () => setRemovendoId(null),
    });
  };

  // Desabilita só a linha em pausa/reativação (não todas).
  const handlePausarReativar = (mlItemId: string, novoStatus: 'ativo' | 'pausado') => {
    setPausandoId(mlItemId);
    pausarReativar({ mlItemId, status: novoStatus }, {
      onSuccess: () => toast.success(novoStatus === 'pausado' ? 'Anúncio pausado' : 'Anúncio reativado'),
      onError: (err) =>
        toast.error(novoStatus === 'pausado' ? 'Falha ao pausar' : 'Falha ao reativar', {
          description: err instanceof Error ? err.message : String(err),
        }),
      onSettled: () => setPausandoId(null),
    });
  };

  // Merge status ao vivo (memoizado: só recomputa quando publicados/statusData mudam,
  // não a cada tecla na busca).
  const merged: PublicadoItem[] = useMemo(() => {
    const statusMap = new Map((statusData?.itens ?? []).map((s) => [s.ml_item_id, s]));
    const vendasPorItem = resumo.porItem;
    return publicados.map((item) => {
      const s = statusMap.get(item.mlItemId);
      const v = vendasPorItem[item.mlItemId];
      const comVendas = {
        unidadesVendidas: v?.unidades ?? null,
        valorVendido: v?.valor ?? null,
      };
      return s
        ? { ...item, canal: s.canal ?? 'mercado_livre', status: s.status, estoque: s.estoque, precoAtual: s.preco, motivo: s.motivo, listingType: s.listingType ?? null, ...comVendas }
        : { ...item, status: 'indisponivel' as StatusPublicado, ...comVendas };
    });
  }, [publicados, statusData, resumo]);

  // Recorte da tela pelo canal global (D2/D3). Contadores por canal para as tabs.
  const contadoresCanal = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of merged) {
      const c = i.canal ?? 'mercado_livre';
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [merged]);
  const doCanal = useMemo(
    () => (canalAtivo === 'todos' ? merged : merged.filter((i) => (i.canal ?? 'mercado_livre') === canalAtivo)),
    [merged, canalAtivo],
  );

  const totalModerados = useMemo(
    () => doCanal.filter((i) => i.status === 'moderado').length,
    [doCanal],
  );

  const itensExibidos = useMemo(
    () => ordenarPublicados(filtrarPublicados(doCanal, filtro), ord),
    [doCanal, filtro, ord],
  );
  const pag = useMemo(() => paginar(itensExibidos, pagina, tamanho), [itensExibidos, pagina, tamanho]);
  const topoRef = useRef<HTMLDivElement>(null);

  const irPara = (p: number) => {
    aplicar(() => ({ pagina: p }));
    topoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const setTamanho = (n: number) => aplicar(() => ({ tamanho: n, pagina: 1 }));

  const removerFiltro = (chave: ChaveFiltro) =>
    setFiltro((f) => ({ ...f, [chave]: chave === 'busca' ? '' : null }));
  const limparFiltros = () =>
    aplicar((a) => ({ filtro: {}, pagina: 1, ord: a.ord, tamanho: a.tamanho }));

  // Fornecedores distintos para o filtro
  const fornecedores = useMemo(
    () => Array.from(new Set(publicados.map((i) => i.fornecedor).filter(Boolean) as string[])).sort(),
    [publicados],
  );

  // Tipos distintos (rótulo exibido = categoria real do ML, ou "Outro") para o filtro.
  const tipos = useMemo(
    () => Array.from(new Set(publicados.map(rotuloTipo))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
    [publicados],
  );

  // Exportação: monta o relatório do estado atual (filtrado/ordenado). Quando o
  // usuário pede "linhas expandidas", busca as famílias dos itens exibidos para
  // incluir o resumo de viabilidade (preço de publicação, custo, markup, concorrência).
  const montarRelatorio = async (config: ExportConfig): Promise<ReportData> => {
    let viabilidades: Map<string, ResumoViabilidade> | undefined;
    if (config.expandido) {
      viabilidades = new Map();
      await Promise.all(
        itensExibidos.map(async (it) => {
          try {
            const familia = await fetchFamiliaPublicada(it.familiaId);
            viabilidades!.set(it.familiaId, resumoViabilidade(familia, it.precoAtual ?? it.precoPublicacao));
          } catch {
            // item sem família acessível → fica sem sublinha de viabilidade
          }
        }),
      );
    }
    return buildPublicadosReport({
      itens: itensExibidos,
      todosItens: doCanal,
      totais: { faturamento: resumo.bruto, unidades: resumo.unidades, pedidos: resumo.pedidos },
      liquido: resumo.liquido,
      markupPct,
      lucro: resumo.lucro,
      filtro,
      periodo,
      config,
      viabilidades,
    });
  };

  if (loadingPublicados) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Carregando publicados...</div>
    );
  }

  if (erroPublicados) {
    return (
      <div className="p-6 text-sm text-destructive">
        Erro ao carregar: {(erroPublicados as Error).message}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Publicados"
        actions={
          <div className="flex items-center gap-2">
            {publicados.length > 0 && (
              <BotaoExportar temExpansao temKpis montarReport={montarRelatorio} />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchStatus(); refetchMetricas(); }}
              disabled={fetchingStatus || fetchingMetricas}
            >
              <RefreshCw className={cn('mr-1.5 h-4 w-4', (fetchingStatus || fetchingMetricas) && 'animate-spin')} />
              {fetchingStatus || fetchingMetricas ? 'Atualizando…' : 'Atualizar'}
            </Button>
          </div>
        }
      />

      <CanalTabs
        canal={canalAtivo}
        onCanal={setCanal}
        habilitados={habilitados}
        contadores={contadoresCanal}
        className="mb-4"
      />

      {/* Banner sem credencial ML */}
      {statusData?.semCredencialML && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          Conecte sua conta ML nas Configurações para ver o status ao vivo.
        </div>
      )}

      {/* Banner de anúncios moderados pelo ML — clicável, filtra a lista por "Moderado" */}
      {totalModerados > 0 && (
        <button
          type="button"
          onClick={() => setFiltro((f) => ({ ...f, status: f.status === 'moderado' ? null : 'moderado' }))}
          aria-pressed={filtro.status === 'moderado'}
          className={cn(
            'mb-4 flex w-full items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-left text-sm text-warning transition-colors hover:bg-warning/20 motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter',
            filtro.status === 'moderado' && 'ring-2 ring-warning/50',
          )}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {totalModerados === 1
              ? '1 anúncio moderado pelo Mercado Livre — clique para ver.'
              : `${totalModerados} anúncios moderados pelo Mercado Livre — clique para ver.`}
          </span>
          {filtro.status === 'moderado' && <span className="font-medium">• filtrando</span>}
        </button>
      )}

      {/* Erro de remoção */}
      {erroRemover && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          {(erroRemover as Error).message}
        </div>
      )}

      {/* Erro de pausar/reativar */}
      {erroPausar && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive motion-safe:animate-in fade-in-0 duration-(--motion-duration-state) ease-enter">
          {(erroPausar as Error).message}
        </div>
      )}

      {/* Estado vazio */}
      {publicados.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="Nenhum anúncio publicado ainda"
          description="Publique um lote para ver seus anúncios aqui, com status ao vivo do Mercado Livre."
          action={
            <Button asChild>
              <Link to="/lotes">Novo lote</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Ponte para o Financeiro: líquido recebido no período (clicável) */}
          {resumo.pedidos > 0 && (
            <Link
              to="/financeiro"
              className="group mb-3 flex cursor-pointer items-center justify-between rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-success" />
                <span className="text-sm text-muted-foreground">Líquido das vendas (você recebe)</span>
                <span className="text-lg font-semibold tabular-nums text-success">{fmtBRL(resumo.liquido)}</span>
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Ver financeiro <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          )}

          {/* Dashboard de KPIs de venda */}
          <DashboardPublicados
            itens={doCanal}
            totais={{ faturamento: resumo.bruto, unidades: resumo.unidades, pedidos: resumo.pedidos }}
            periodo={periodo}
            onPeriodo={setPeriodo}
            carregando={fetchingMetricas}
            aviso={erroVendas ? 'Não foi possível ler as vendas. Tente Atualizar.' : null}
            markupPct={markupPct}
            lucro={resumo.lucro}
            somenteEncalhados={filtro.somenteEncalhados}
            onToggleEncalhados={() => setFiltro((f) => ({ ...f, somenteEncalhados: !f.somenteEncalhados }))}
          />

          {/* Filtros */}
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              placeholder="Buscar por título, código, fornecedor…"
              value={filtro.busca ?? ''}
              onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))}
              className="h-8 w-[200px] text-sm"
            />

            <Select
              value={filtro.fornecedor ?? '__todos'}
              onValueChange={(v) => setFiltro((f) => ({ ...f, fornecedor: v === '__todos' ? null : v }))}
            >
              <SelectTrigger className="h-8 w-[160px] text-sm">
                <SelectValue placeholder="Fornecedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos fornecedores</SelectItem>
                {fornecedores.map((fn) => (
                  <SelectItem key={fn} value={fn}>{fn}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtro.status ?? '__todos'}
              onValueChange={(v) =>
                setFiltro((f) => ({ ...f, status: v === '__todos' ? null : (v as StatusPublicado | 'problema') }))
              }
            >
              <SelectTrigger className="h-8 w-[150px] text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos status</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="pausado">Pausado</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
                <SelectItem value="moderado">Moderado</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
                <SelectItem value="indisponivel">Indisponível</SelectItem>
                <SelectItem value="problema">Com problema</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filtro.tipo ?? '__todos'}
              onValueChange={(v) =>
                setFiltro((f) => ({ ...f, tipo: v === '__todos' ? null : v }))
              }
            >
              <SelectTrigger className="h-8 w-[180px] text-sm">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos tipos</SelectItem>
                {tipos.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FiltrosAtivos filtro={filtro} onRemover={removerFiltro} onLimpar={limparFiltros} />

          {/* Tabela */}
          <div ref={topoRef} className="scroll-mt-6 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
                  <ThOrdenavel coluna="titulo" label="Título" ord={ord} onOrdenar={ordenarPor} className="sticky left-0 z-10 bg-muted/50 sm:static sm:z-auto sm:bg-transparent" />
                  <ThOrdenavel coluna="precoPublicacao" label="Preço publicado" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="estoque" label="Estoque atual" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="precoAtual" label="Preço atual" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="unidadesVendidas" label="Unid. vendidas" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="valorVendido" label="Valor vendido" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="status" label="Status" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="publicadoEm" label="Publicado em" ord={ord} onOrdenar={ordenarPor} />
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itensExibidos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                      Nenhum resultado para os filtros aplicados.
                    </TableCell>
                  </TableRow>
                ) : (
                  pag.itensPagina.map((item) => (
                    <LinhaTabela
                      key={item.familiaId}
                      item={item}
                      onRemover={handleRemover}
                      removendo={removendo && removendoId === item.familiaId}
                      onPausarReativar={handlePausarReativar}
                      pausando={pausandoOuReativando && pausandoId === item.mlItemId}
                      isAdmin={isAdmin}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Pagination
            rotuloItem="anúncio"
            className="mt-2"
            paginaAtual={pag.paginaAtual}
            totalPaginas={pag.totalPaginas}
            inicio={pag.inicio}
            fim={pag.fim}
            total={pag.total}
            tamanho={tamanho}
            onIrPara={irPara}
            onTamanho={setTamanho}
          />
        </>
      )}
    </div>
  );
}
