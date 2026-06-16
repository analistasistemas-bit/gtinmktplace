import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, ExternalLink, Trash2, FileText, PackageOpen, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { filtrarPublicados, ordenarPublicados } from '@/lib/publicados';
import type { PublicadoItem, StatusPublicado, FiltroPublicados, ColunaOrdenavel, OrdenacaoPublicados } from '@/lib/publicados';
import type { TipoAviamento } from '@/lib/tipos-dominio';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { useRemoverPublicado } from '@/hooks/useRemoverPublicado';
import { usePaginacao } from '@/hooks/usePaginacao';
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
        <span className="text-xs text-warning">{motivo}</span>
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

function nomeTipo(tipo: TipoAviamento | null): string {
  switch (tipo) {
    case 'linha': return 'Linha';
    case 'fita': return 'Fita';
    case 'botao': return 'Botão';
    case 'cola': return 'Cola';
    case 'outro': return 'Outro';
    default: return '—';
  }
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
      <TableCell className="text-sm">{item.fornecedor ?? '—'}</TableCell>
      <TableCell className="text-sm">{nomeTipo(item.tipo)}</TableCell>
      <TableCell className="text-sm tabular-nums">{item.precoPublicacao > 0 ? fmtBRL(item.precoPublicacao) : '—'}</TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.estoque != null ? item.estoque : '—'}
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {item.precoAtual != null ? fmtBRL(item.precoAtual) : '—'}
      </TableCell>
      <TableCell>
        <BadgeStatus status={item.status ?? 'indisponivel'} motivo={item.motivo} />
      </TableCell>
      <TableCell className="text-sm">{fmtData(item.publicadoEm)}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!item.descricao}
              >
                <FileText className="mr-1 h-3 w-3" />
                Descrição
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="uppercase">{item.titulo}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground">
                {item.descricao}
              </div>
            </DialogContent>
          </Dialog>

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
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                disabled={removendo}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Remover
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

  const [filtro, setFiltro] = useState<FiltroPublicados>({});
  const [ord, setOrd] = useState<OrdenacaoPublicados | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  // Clicar na coluna cicla: asc → desc → sem ordenação (volta à ordem natural).
  const ordenarPor = (coluna: ColunaOrdenavel) => {
    setOrd((atual) => {
      if (atual?.coluna !== coluna) return { coluna, dir: 'asc' };
      if (atual.dir === 'asc') return { coluna, dir: 'desc' };
      return null;
    });
  };

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
    return publicados.map((item) => {
      const s = statusMap.get(item.mlItemId);
      return s
        ? { ...item, status: s.status, estoque: s.estoque, precoAtual: s.preco, motivo: s.motivo }
        : { ...item, status: 'indisponivel' as StatusPublicado };
    });
  }, [publicados, statusData]);

  const itensExibidos = useMemo(
    () => ordenarPublicados(filtrarPublicados(merged, filtro), ord),
    [merged, filtro, ord],
  );
  const pag = usePaginacao(itensExibidos);
  const topoRef = useRef<HTMLDivElement>(null);

  const irPara = (p: number) => {
    pag.irPara(p);
    topoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Mudar qualquer filtro/busca/ordenação volta para a página 1.
  useEffect(() => {
    pag.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro.busca, filtro.fornecedor, filtro.status, filtro.tipo, ord?.coluna, ord?.dir]);

  // Fornecedores distintos para o filtro
  const fornecedores = useMemo(
    () => Array.from(new Set(publicados.map((i) => i.fornecedor).filter(Boolean) as string[])).sort(),
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
            onClick={() => refetchStatus()}
            disabled={fetchingStatus}
          >
            <RefreshCw className={cn('mr-1.5 h-4 w-4', fetchingStatus && 'animate-spin')} />
            {fetchingStatus ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {/* Banner sem credencial ML */}
      {statusData?.semCredencialML && (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Conecte sua conta ML nas Configurações para ver o status ao vivo.
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
          description="Os anúncios publicados no Mercado Livre aparecem aqui com o status ao vivo."
        />
      ) : (
        <>
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
                setFiltro((f) => ({ ...f, tipo: v === '__todos' ? null : (v as TipoAviamento) }))
              }
            >
              <SelectTrigger className="h-8 w-[130px] text-sm">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos tipos</SelectItem>
                <SelectItem value="linha">Linha</SelectItem>
                <SelectItem value="fita">Fita</SelectItem>
                <SelectItem value="botao">Botão</SelectItem>
                <SelectItem value="cola">Cola</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
            tamanho={pag.tamanho}
            onIrPara={irPara}
            onTamanho={pag.setTamanho}
          />
        </>
      )}
    </div>
  );
}
