// Pulse (ADR-0119): lista do radar. A leitura que decide reprecificar é "onde estou em relação ao
// menor concorrente" — por isso ela é coluna própria, e não um número escondido no detalhe.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreVertical, Pause, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pausarPulseProduto, type PulseProduto, type PulseResumoOfertas } from '@/lib/pulse';
import {
  classeTom, motivoSemPrecoProprio, ordemPriceToWin, posicaoVsMercado, seloAnuncio, seloPriceToWin,
} from '@/lib/pulse-formato';
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

export function TabelaRadar({ produtos, resumo, resumoCarregando, onAbrirDetalhe }: {
  produtos: PulseProduto[];
  /** Ofertas por produto — a query vive na página, para KPIs e tabela lerem o mesmo dado. */
  resumo: Map<string, PulseResumoOfertas> | undefined;
  resumoCarregando: boolean;
  onAbrirDetalhe: (produtoId: string) => void;
}) {
  const qc = useQueryClient();

  /** Enquanto as ofertas carregam, um traço mentiria ("sem concorrência") — mostramos o skeleton. */
  const celulaMercado = (conteudo: React.ReactNode) =>
    resumoCarregando ? <Skeleton className="ml-auto h-4 w-14" /> : conteudo;

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
        // Anúncio fora do ar precisa se identificar na lista: sem isso, ele aparece como um
        // produto qualquer sem preço, e a razão só sai no tooltip.
        const selo = seloAnuncio(p);
        return (
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              {/* Ficha sem nome ainda: o código do ML não é nome de produto, vai só no title. */}
              <span className="block truncate font-medium" title={p.titulo ? undefined : p.catalog_product_id}>
                {p.titulo ?? 'Ficha sem nome'}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {p.gtin ?? p.codigo_pai ?? '—'}
                {selo && (
                  <Badge
                    variant="outline"
                    className={cn('ml-2 px-1.5 py-0 text-[10px] font-normal', classeTom(selo.tom))}
                    title={selo.ajuda}
                  >
                    {selo.texto}
                  </Badge>
                )}
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
      // Preço vivo da nossa oferta na ficha. Quando não há oferta nossa lá, a célula diz por quê
      // — em branco, uma coluna de dinheiro lê como tela quebrada.
      cell: (p) =>
        p.meu_preco != null ? (
          <span className="tabular-nums">{fmtBRL(p.meu_preco)}</span>
        ) : (
          <span className="cursor-help text-muted-foreground" title={motivoSemPrecoProprio(p)}>
            —
          </span>
        ),
    },
    {
      key: 'menor',
      header: 'Menor concorrente',
      className: 'text-right',
      sortValue: (p) => menorDe(p),
      cell: (p) => {
        const v = menorDe(p);
        return celulaMercado(<span className="tabular-nums">{v != null ? fmtBRL(v) : '—'}</span>);
      },
    },
    {
      key: 'posicao',
      header: 'Sua posição',
      // Ordena pelo delta: quem está mais caro sobe primeiro em desc — a fila de trabalho do dia.
      sortValue: (p) => posicaoDe(p)?.deltaPct ?? null,
      cell: (p) => {
        const pos = posicaoDe(p);
        if (resumoCarregando) return <Skeleton className="h-4 w-24" />;
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
      className: 'hidden text-right md:table-cell',
      sortValue: (p) => resumo?.get(p.id)?.nOfertas ?? null,
      cell: (p) => celulaMercado(<span className="tabular-nums">{resumo?.get(p.id)?.nOfertas ?? '—'}</span>),
    },
    {
      key: 'ptw',
      // "Price-to-win" é o nome de outra API do ML (a disputa pelo primeiro lugar do catálogo).
      // O que esta coluna mostra é o preço de referência que o ML calcula para o anúncio.
      header: 'Referência do ML',
      className: 'hidden lg:table-cell',
      // Escala ordinal (mais barato → mais caro), não alfabética: ordenar por texto colocaria
      // "Abaixo da referência" antes de "Acima da referência" e misturaria a leitura.
      sortValue: (p) => ordemPriceToWin(p),
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
              size="icon-sm"
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
      loading={resumoCarregando && produtos.length === 0}
      defaultSort={{ key: 'posicao', dir: 'desc' }}
      onRowClick={(p) => onAbrirDetalhe(p.id)}
      rowClassName={(p) => (p.status === 'pausado' ? 'opacity-55' : undefined)}
    />
  );
}
