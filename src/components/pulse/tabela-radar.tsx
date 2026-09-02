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
import { pausarPulseProduto, type ContextoMargem, type PulseProduto, type PulseResumoOfertas } from '@/lib/pulse';
import {
  classeTom, disputaCatalogo, motivoSemPrecoProprio, posicaoVsMercado, seloAnuncio,
} from '@/lib/pulse-formato';
import { insumoFaltante, margemEstimada } from '@/lib/pulse-margem';
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

export function TabelaRadar({
  produtos, resumo, resumoCarregando, contextos, onAbrirDetalhe, onReprecificar,
}: {
  produtos: PulseProduto[];
  /** Ofertas por produto — a query vive na página, para KPIs e tabela lerem o mesmo dado. */
  resumo: Map<string, PulseResumoOfertas> | undefined;
  resumoCarregando: boolean;
  /** Custo + alíquota por `codigo_pai` (ADR-0119 Errata 12 D-3). `undefined` = ainda carregando —
   *  e aí a célula mostra skeleton, porque um `—` significaria "insumo faltando". */
  contextos: Map<string, ContextoMargem> | undefined;
  onAbrirDetalhe: (produtoId: string) => void;
  onReprecificar: (produto: PulseProduto) => void;
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

  const menorDe = (p: PulseProduto) => resumo?.get(p.id)?.menorRelevante ?? null;
  const posicaoDe = (p: PulseProduto) => posicaoVsMercado(p.meu_preco, menorDe(p));

  const contextoDe = (p: PulseProduto) => (p.codigo_pai ? contextos?.get(p.codigo_pai) : undefined);
  /** `null` quando qualquer insumo falta — a mesma resposta que o detalhe dá (regra LOUD). */
  const sobraDe = (p: PulseProduto) => {
    if (p.meu_preco == null || p.meu_preco <= 0) return null;
    const ctx = contextoDe(p);
    if (insumoFaltante(ctx, p)) return null;
    return margemEstimada({
      preco: p.meu_preco,
      custoProduto: ctx!.custo,
      comissao: { pct: p.comissao_pct, fixa: p.comissao_fixa },
      frete: p.ptw_custos?.frete ?? null,
      aliquotaPct: ctx!.aliquotaPct,
    });
  };

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
      header: 'Menor relevante',
      className: 'text-right',
      sortValue: (p) => menorDe(p),
      cell: (p) => {
        const v = menorDe(p);
        return celulaMercado(
          <span className={cn('tabular-nums', v == null && 'text-muted-foreground')}>
            {v != null ? fmtBRL(v) : 'Sem concorrente relevante'}
          </span>,
        );
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
      key: 'sobra',
      // A pergunta 3 do how-to ("até onde posso baixar") não tinha resposta na tela onde a decisão
      // é tomada: a margem só existia depois de 2 cliques e um dialog 7xl (ADR-0119 Errata 12).
      header: 'Sobra hoje',
      className: 'hidden text-right lg:table-cell',
      sortValue: (p) => sobraDe(p)?.liquido ?? null,
      cell: (p) => {
        // Contexto ainda carregando: um "—" aqui afirmaria "falta insumo", que é outra coisa.
        if (p.codigo_pai && contextos === undefined) return <Skeleton className="ml-auto h-4 w-16" />;
        if (p.meu_preco == null) {
          return <span className="cursor-help text-muted-foreground" title={motivoSemPrecoProprio(p)}>—</span>;
        }
        const falta = insumoFaltante(contextoDe(p), p);
        if (falta) {
          return (
            <span className="cursor-help text-muted-foreground" title={`Margem indisponível: falta ${falta}`}>
              —
            </span>
          );
        }
        const m = sobraDe(p)!;
        // Mesmo limiar do detalhe: dois limiares de "prejuízo" no mesmo módulo é exatamente o
        // defeito que a Errata 6 nos custou.
        return (
          <span className={cn('tabular-nums', m.liquido < 0 ? 'text-destructive' : 'text-success')}>
            {fmtBRL(m.liquido)}
            <span className="ml-1 text-xs font-normal opacity-80">({m.margemPct.toFixed(1)}%)</span>
          </span>
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
      key: 'disputa',
      // ADR-0147: substitui a "Referência do ML" (D-24). "Análise PubliAI" prometia veredito de IA
      // e entrega três fatos verificáveis — o nome do próprio ADR é o que está na célula.
      header: 'Disputa do catálogo',
      // Com a célula de 3 linhas a linha media 76px e só 5 de 13 cabiam acima da dobra em 1440×900
      // (medido). Badge + tooltip devolve a linha ao ritmo das outras; nada de informação sai da
      // tela — a posição hipotética passa a viver no title/sr-only, junto do resto da conta.
      className: 'hidden xl:table-cell',
      sortValue: (p) => disputaCatalogo(resumo?.get(p.id), p.meu_preco)?.posicao ?? null,
      cell: (p) => {
        const d = disputaCatalogo(resumo?.get(p.id), p.meu_preco);
        if (!d) {
          // Texto inalterado: a coluna `menor` já diz "Sem concorrente relevante"; sem o
          // "no catálogo" as duas células ficam idênticas e o teste da linha 110 acha duas.
          return celulaMercado(
            <span className="text-xs text-muted-foreground">Sem concorrente relevante no catálogo</span>,
          );
        }
        const faixa = d.menor === d.maior ? fmtBRL(d.menor) : `${fmtBRL(d.menor)} – ${fmtBRL(d.maior)}`;
        // "ficaria" e não "está": o nosso anúncio não é anúncio de catálogo, então não participa da
        // disputa que gerou a faixa (ADR-0147 D-5).
        const ajuda = [
          `${d.anunciosRelevantes} ${d.anunciosRelevantes === 1 ? 'anúncio relevante disputa' : 'anúncios relevantes disputam'} esta ficha, de ${faixa}.`,
          d.posicao != null && p.meu_preco != null
            ? `Com o seu preço, você ficaria em ${d.posicao}º de ${d.totalComNosso}.`
            : null,
        ].filter(Boolean).join(' ');
        return celulaMercado(
          // Coluna `hidden xl:table-cell`: só existe em desktop grande, onde há mouse — o `title`
          // cobre o hover. `sr-only` (não role/tabIndex) dá a mesma explicação ao leitor de tela
          // sem criar um controle interativo morto na linha, que já é focável e clicável inteira
          // (ver data-table.tsx) — Tab não pode parar duas vezes por linha sem o segundo ponto
          // fazer nada.
          <span className="inline-flex cursor-help items-center gap-1.5" title={ajuda}>
            <Badge variant="outline" className="font-normal tabular-nums">
              {d.anunciosRelevantes} {d.anunciosRelevantes === 1 ? 'disputa' : 'disputam'}
            </Badge>
            <span className="text-xs tabular-nums text-muted-foreground">{faixa}</span>
            <span className="sr-only">{ajuda}</span>
          </span>,
        );
      },
    },
    {
      key: 'acoes',
      header: <span className="sr-only">Ações</span>,
      className: 'w-44 text-right',
      // Em 820px a tabela estoura o container; sem isto o ⋮ — único acesso a "Pausar no radar" —
      // sai da tela.
      stickyRight: true,
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.codigo_pai && (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Reprecificar ${p.titulo ?? p.catalog_product_id}`}
              // A linha inteira é clicável: sem isto, reprecificar abriria o detalhe por baixo.
              onClick={(e) => { e.stopPropagation(); onReprecificar(p); }}
            >
              Reprecificar
            </Button>
          )}
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
        </div>
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
