import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { RefreshCw, ExternalLink, Trash2, PackageOpen, ArrowUp, ArrowDown, ChevronsUpDown, Wallet, ChevronRight, AlertTriangle } from 'lucide-react';
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
import { filtrarPublicados, ordenarPublicados, primeiroNome, rotuloTipo } from '@/lib/publicados';
import { traduzirMotivoModeracao } from '@/lib/moderacao';
import type { PublicadoItem, StatusPublicado, FiltroPublicados, ColunaOrdenavel, OrdenacaoPublicados } from '@/lib/publicados';
import { resolverJanela, type Periodo } from '@/lib/metricas';
import { DashboardPublicados } from '@/components/dashboard-publicados';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { useMetricasVendas } from '@/hooks/useMetricasVendas';
import { useResumoFinanceiro } from '@/hooks/useResumoFinanceiro';
import { useRemoverPublicado } from '@/hooks/useRemoverPublicado';
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
}

const CONTEUDO_ML = (
  <>
    <ExternalLink className="mr-1 h-3 w-3" />
    ML
  </>
);

function LinhaTabela({ item, onRemover, removendo }: LinhaProps) {
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="max-w-[260px]">
          <p className="text-sm font-medium uppercase break-words">{item.titulo}</p>
          <p className="text-xs text-muted-foreground">{item.codigoPai}</p>
        </div>
      </TableCell>
      <TableCell className="text-sm" title={item.fornecedor ?? undefined}>{primeiroNome(item.fornecedor) ?? '—'}</TableCell>
      <TableCell className="text-sm">{rotuloTipo(item)}</TableCell>
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
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="sm"
            disabled={!item.mlPermalink}
            className="h-7 px-2 text-xs"
          >
            {item.mlPermalink ? (
              <a href={item.mlPermalink} target="_blank" rel="noreferrer">{CONTEUDO_ML}</a>
            ) : (
              <span>{CONTEUDO_ML}</span>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remover"
                title="Remover"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                disabled={removendo}
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
}

function ThOrdenavel({ coluna, label, ord, onOrdenar }: ThOrdenavelProps) {
  const ativo = ord?.coluna === coluna;
  return (
    <TableHead>
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

  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const { data: metricas, isFetching: fetchingMetricas, refetch: refetchMetricas } = useMetricasVendas(janela);
  const { data: financeiro } = useResumoFinanceiro(janela);

  const markupPct = useMemo(() => {
    const vendas = financeiro?.vendas;
    if (!vendas?.length) return null;
    let liq = 0, cst = 0;
    for (const v of vendas) {
      if (v.custo != null && v.custo > 0) { liq += v.liquido; cst += v.custo; }
    }
    return cst > 0 ? (liq - cst) / cst : null;
  }, [financeiro]);

  // Estado da tela (filtro/ordenação/página/tamanho) vive na URL: ao abrir um
  // detalhe e voltar (back), o navegador restaura tudo. Setters usam replace para
  // não empilhar histórico a cada tecla. Mudar filtro/ordenação volta à página 1.
  const [searchParams, setSearchParams] = useSearchParams();
  const { filtro, ord, pagina, tamanho } = useMemo(() => paramsParaEstado(searchParams), [searchParams]);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

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

  // Merge status ao vivo (memoizado: só recomputa quando publicados/statusData mudam,
  // não a cada tecla na busca).
  const merged: PublicadoItem[] = useMemo(() => {
    const statusMap = new Map((statusData?.itens ?? []).map((s) => [s.ml_item_id, s]));
    const vendasPorItem = metricas?.porItem ?? {};
    return publicados.map((item) => {
      const s = statusMap.get(item.mlItemId);
      const v = vendasPorItem[item.mlItemId];
      const comVendas = {
        unidadesVendidas: v?.unidades ?? null,
        valorVendido: v?.valor ?? null,
      };
      return s
        ? { ...item, status: s.status, estoque: s.estoque, precoAtual: s.preco, motivo: s.motivo, ...comVendas }
        : { ...item, status: 'indisponivel' as StatusPublicado, ...comVendas };
    });
  }, [publicados, statusData, metricas]);

  const totalModerados = useMemo(
    () => merged.filter((i) => i.status === 'moderado').length,
    [merged],
  );

  const itensExibidos = useMemo(
    () => ordenarPublicados(filtrarPublicados(merged, filtro), ord),
    [merged, filtro, ord],
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
    <div className="p-6">
      <PageHeader
        title="Publicados"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchStatus(); refetchMetricas(); }}
            disabled={fetchingStatus || fetchingMetricas}
          >
            <RefreshCw className={cn('mr-1.5 h-4 w-4', (fetchingStatus || fetchingMetricas) && 'animate-spin')} />
            {fetchingStatus || fetchingMetricas ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {/* Banner sem credencial ML */}
      {statusData?.semCredencialML && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conecte sua conta ML nas Configurações para ver o status ao vivo.
        </div>
      )}

      {/* Banner de anúncios moderados pelo ML */}
      {totalModerados > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {totalModerados === 1
              ? '1 anúncio moderado pelo Mercado Livre — verifique abaixo.'
              : `${totalModerados} anúncios moderados pelo Mercado Livre — verifique abaixo.`}
          </span>
        </div>
      )}

      {/* Erro de remoção */}
      {erroRemover && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {(erroRemover as Error).message}
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
              <Link to="/novo-lote">Novo lote</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Ponte para o Financeiro: líquido recebido no período (clicável) */}
          {financeiro && !financeiro.semCredencialMP && !financeiro.erroFinanceiro && (
            <Link
              to="/financeiro"
              className="group mb-3 flex cursor-pointer items-center justify-between rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-success" />
                <span className="text-sm text-muted-foreground">Líquido das vendas (você recebe)</span>
                <span className="text-lg font-semibold tabular-nums text-success">{fmtBRL(financeiro.liquido)}</span>
              </div>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Ver financeiro <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          )}

          {/* Dashboard de KPIs de venda */}
          <DashboardPublicados
            itens={merged}
            totais={metricas?.totais ?? { faturamento: 0, unidades: 0, pedidos: 0 }}
            periodo={periodo}
            onPeriodo={setPeriodo}
            carregando={fetchingMetricas}
            aviso={metricas?.erroVendas ?? null}
            markupPct={markupPct}
          />

          {/* Filtros */}
          <div className="mb-3 flex flex-wrap gap-2">
            <Input
              placeholder="Buscar por título…"
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
                setFiltro((f) => ({ ...f, status: v === '__todos' ? null : (v as StatusPublicado) }))
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
                  <ThOrdenavel coluna="titulo" label="Título" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="fornecedor" label="Fornecedor" ord={ord} onOrdenar={ordenarPor} />
                  <ThOrdenavel coluna="tipo" label="Tipo" ord={ord} onOrdenar={ordenarPor} />
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
                    <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">
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
