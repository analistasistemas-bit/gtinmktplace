import { useMemo, useState } from 'react';
import { RefreshCw, ExternalLink, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { filtrarPublicados } from '@/lib/publicados';
import type { PublicadoItem, StatusPublicado, FiltroPublicados } from '@/lib/publicados';
import type { TipoAviamento } from '@/lib/tipos-dominio';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { useRemoverPublicado } from '@/hooks/useRemoverPublicado';

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

function BadgeStatus({ status, motivo }: { status: StatusPublicado; motivo?: string | null }) {
  const cls = {
    ativo: 'bg-green-50 text-green-700 border border-green-200',
    pausado: 'bg-muted text-muted-foreground',
    encerrado: 'bg-gray-200 text-gray-700',
    moderado: 'bg-amber-50 text-amber-700 border border-amber-200',
    inativo: 'bg-red-50 text-red-700 border border-red-200',
    indisponivel: 'border border-dashed border-red-300 text-red-600',
  }[status];

  return (
    <span className="flex flex-col gap-0.5">
      <Badge className={cn('w-fit font-medium', cls)}>{STATUS_LABEL[status]}</Badge>
      {status === 'moderado' && motivo && (
        <span className="text-xs text-amber-600">{motivo}</span>
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
    <tr className="border-b transition-colors hover:bg-muted/30">
      <td className="px-3 py-2">
        <div className="max-w-[220px]">
          <p className="truncate text-sm font-medium uppercase">{item.titulo}</p>
          <p className="text-xs text-muted-foreground">{item.codigoPai}</p>
        </div>
      </td>
      <td className="px-3 py-2 text-sm">{item.fornecedor ?? '—'}</td>
      <td className="px-3 py-2 text-sm">{nomeTipo(item.tipo)}</td>
      <td className="px-3 py-2 text-sm tabular-nums">{item.precoPublicacao > 0 ? fmtBRL(item.precoPublicacao) : '—'}</td>
      <td className="px-3 py-2 text-sm tabular-nums">
        {item.estoque != null ? item.estoque : '—'}
      </td>
      <td className="px-3 py-2 text-sm tabular-nums">
        {item.precoAtual != null ? fmtBRL(item.precoAtual) : '—'}
      </td>
      <td className="px-3 py-2">
        <BadgeStatus status={item.status ?? 'indisponivel'} motivo={item.motivo} />
      </td>
      <td className="px-3 py-2 text-sm">{fmtData(item.publicadoEm)}</td>
      <td className="px-3 py-2">
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
      </td>
    </tr>
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
  const [removendoId, setRemovendoId] = useState<string | null>(null);

  // Desabilita só a linha em remoção (não todas).
  const handleRemover = (familiaId: string) => {
    setRemovendoId(familiaId);
    remover(familiaId, { onSettled: () => setRemovendoId(null) });
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

  const itensExibidos = filtrarPublicados(merged, filtro);

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
      {/* Cabeçalho */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Publicados</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchStatus()}
          disabled={fetchingStatus}
        >
          <RefreshCw className={cn('mr-1.5 h-4 w-4', fetchingStatus && 'animate-spin')} />
          {fetchingStatus ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      {/* Banner sem credencial ML */}
      {statusData?.semCredencialML && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
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
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum anúncio publicado ainda.
        </div>
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
              </SelectContent>
            </Select>
          </div>

          {/* Tabela */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                  <th className="px-3 py-2">Título</th>
                  <th className="px-3 py-2">Fornecedor</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Preço publicado</th>
                  <th className="px-3 py-2">Estoque atual</th>
                  <th className="px-3 py-2">Preço atual</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Publicado em</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {itensExibidos.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      Nenhum resultado para os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  itensExibidos.map((item) => (
                    <LinhaTabela
                      key={item.familiaId}
                      item={item}
                      onRemover={handleRemover}
                      removendo={removendo && removendoId === item.familiaId}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            {itensExibidos.length} de {publicados.length} anúncio{publicados.length !== 1 ? 's' : ''}
          </p>
        </>
      )}
    </div>
  );
}
