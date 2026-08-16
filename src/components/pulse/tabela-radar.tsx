// Pulse (ADR-0119): lista do radar. A leitura que decide reprecificar é "onde estou em relação ao
// menor concorrente" — por isso ela é coluna própria, e não um número escondido no detalhe.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreVertical, Pause, Play, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetchPulseResumoOfertas, pausarPulseProduto, type PulseProduto } from '@/lib/pulse';
import { classeTom, posicaoVsMercado, seloPriceToWin } from '@/lib/pulse-formato';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';

function relativo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return `há ${Math.round(diffH / 24)}d`;
}

export function TabelaRadar({ produtos, onAbrirDetalhe }: {
  produtos: PulseProduto[];
  onAbrirDetalhe: (produtoId: string) => void;
}) {
  const qc = useQueryClient();
  const ids = produtos.map((p) => p.id);
  const { data: resumo, isLoading } = useQuery({
    queryKey: ['pulse', 'ofertas-resumo', ids],
    queryFn: () => fetchPulseResumoOfertas(ids),
    enabled: ids.length > 0,
  });

  const pausar = useMutation({
    mutationFn: ({ id, pausar: p }: { id: string; pausar: boolean }) => pausarPulseProduto(id, p),
    onSuccess: (_r, { pausar: p }) => {
      toast.success(p ? '✓ Produto pausado no radar' : '✓ Produto reativado no radar');
      qc.invalidateQueries({ queryKey: ['pulse'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const menorDe = (p: PulseProduto) => resumo?.get(p.id)?.menorPreco ?? null;
  const posicaoDe = (p: PulseProduto) => posicaoVsMercado(p.meu_preco, menorDe(p));

  const colunas: Column<PulseProduto>[] = [
    {
      key: 'produto',
      header: 'Produto',
      sortValue: (p) => (p.titulo ?? p.catalog_product_id).toLowerCase(),
      className: 'max-w-[340px]',
      cell: (p) => {
        // Defasagem só vira ruído visual quando é real: o teto por execução faz alguns produtos
        // ficarem para o ciclo seguinte, e passar de 2 dias é sinal de algo travado.
        const horas = p.ultimo_snapshot_em
          ? (Date.now() - new Date(p.ultimo_snapshot_em).getTime()) / 3_600_000
          : Infinity;
        return (
          <div className="flex items-start gap-2">
            {p.origem === 'manual' && (
              <Sparkles className="mt-1 h-3.5 w-3.5 shrink-0 text-info" aria-label="Adicionado manualmente" />
            )}
            <div className="min-w-0">
              <span className="block truncate font-medium">{p.titulo ?? p.catalog_product_id}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {p.gtin ?? p.codigo_pai ?? '—'}
                {horas > 48 && (
                  <span className="ml-2 text-warning" title={`Última coleta ${relativo(p.ultimo_snapshot_em)}`}>
                    · coleta {relativo(p.ultimo_snapshot_em)}
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      key: 'meu',
      header: 'Seu preço',
      className: 'text-right',
      sortValue: (p) => p.meu_preco,
      cell: (p) => (
        <span className="tabular-nums">{p.meu_preco != null ? fmtBRL(p.meu_preco) : '—'}</span>
      ),
    },
    {
      key: 'menor',
      header: 'Menor concorrente',
      className: 'text-right',
      sortValue: (p) => menorDe(p),
      cell: (p) => {
        const v = menorDe(p);
        return <span className="tabular-nums">{v != null ? fmtBRL(v) : '—'}</span>;
      },
    },
    {
      key: 'posicao',
      header: 'Sua posição',
      // Ordena pelo delta: quem está mais caro sobe primeiro em desc — a fila de trabalho do dia.
      sortValue: (p) => posicaoDe(p)?.deltaPct ?? null,
      cell: (p) => {
        const pos = posicaoDe(p);
        if (!pos) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={cn('font-normal tabular-nums', classeTom(pos.tom))}>
            {pos.texto}
          </Badge>
        );
      },
    },
    {
      key: 'ofertas',
      header: 'Ofertas',
      className: 'text-right',
      sortValue: (p) => resumo?.get(p.id)?.nOfertas ?? null,
      cell: (p) => <span className="tabular-nums">{resumo?.get(p.id)?.nOfertas ?? '—'}</span>,
    },
    {
      key: 'ptw',
      header: 'Price-to-win',
      sortValue: (p) => seloPriceToWin(p)?.texto ?? null,
      cell: (p) => {
        const selo = seloPriceToWin(p);
        if (!selo) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className={cn('font-normal', classeTom(selo.tom))} title={selo.ajuda}>
            {selo.texto}
          </Badge>
        );
      },
    },
    {
      key: 'acoes',
      header: <span className="sr-only">Ações</span>,
      className: 'w-10',
      cell: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 px-0"
              aria-label={`Mais ações para ${p.titulo ?? p.catalog_product_id}`}
              // O clique do menu não pode abrir o detalhe da linha (a linha inteira é clicável).
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {p.status === 'pausado' ? (
              <DropdownMenuItem onSelect={() => pausar.mutate({ id: p.id, pausar: false })}>
                <Play className="mr-2 h-3.5 w-3.5" />
                Reativar no radar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => pausar.mutate({ id: p.id, pausar: true })}>
                <Pause className="mr-2 h-3.5 w-3.5" />
                Pausar no radar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <DataTable
      columns={colunas}
      rows={produtos}
      rowKey={(p) => p.id}
      loading={isLoading && produtos.length === 0}
      defaultSort={{ key: 'posicao', dir: 'desc' }}
      onRowClick={(p) => onAbrirDetalhe(p.id)}
      rowClassName={(p) => (p.status === 'pausado' ? 'opacity-55' : undefined)}
    />
  );
}
