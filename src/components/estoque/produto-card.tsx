// Linha de produto da tela Estoque. Não existe <table> nesta tela (guarda em Estoque.test.tsx):
// o painel expandido é filho da linha e o min-content de tabela aninhada estourava a largura da
// página. O alinhamento de colunas vem de CSS Grid com tracks FIXOS — grid não dimensiona track
// por conteúdo do jeito que a tabela dimensiona, então GTIN/nome longo não empurra nada.
import { useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, MoreVertical, PackageMinus, PackagePlus, Plus, Receipt, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { CanalBadge } from '@/components/canal-badge';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import {
  VariacaoEstoqueLinha, CabecalhoVariacoes, PillSaldo, type StatusPublicacaoLinha,
} from '@/components/estoque/variacao-estoque-linha';
import { useImageUrl } from '@/hooks/useImageUrl';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { cn } from '@/lib/utils';
import { QK } from '@/lib/queries';
import {
  fetchVariacoesProduto, mergeProdutoComVariacoes,
  urlFotoMl, type ProdutoComSaldo, type ProdutoEstoqueResumo, type VariacaoComSaldo,
} from '@/lib/produtos-saldo';

/** Acima deste limite a lista de variações no expand usa virtualização. */
export const VARIACOES_VIRTUAL_THRESHOLD = 50;

export const VARIACAO_ROW_ESTIMATE_PX = 56;

function ListaVariacoesEstoque({ variacoes, nomeProduto, precoMl, statusPublicacao }: {
  variacoes: VariacaoComSaldo[];
  nomeProduto: string;
  precoMl: (v: VariacaoComSaldo) => number | null;
  statusPublicacao: (codigo: string) => StatusPublicacaoLinha;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: variacoes.length,
    getScrollElement: () => scrollRef.current,
    // Desktop (~2 linhas na célula identidade). Mobile ganha 3ª linha (custo/preço) — measureElement corrige.
    estimateSize: () => VARIACAO_ROW_ESTIMATE_PX,
    overscan: 5,
  });

  return (
    <div
      ref={scrollRef}
      data-testid="variacoes-virtual-scroll"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- região scrollável precisa ser focável (WCAG 2.1.1)
      tabIndex={0}
      role="region"
      aria-label={`Variações de ${nomeProduto}`}
      className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
    >
      <div
        data-testid="variacoes-virtual-inner"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <VariacaoEstoqueLinha
              variacao={variacoes[virtualRow.index]!}
              precoMl={precoMl(variacoes[virtualRow.index]!)}
              statusPublicacao={statusPublicacao(variacoes[virtualRow.index]!.codigo)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface AlvoEntrada {
  /** Só preenchido quando o produto tem UMA variação — com várias, a escolha é do operador. */
  sku?: string;
  codigoPai: string;
}

/**
 * Template compartilhado entre o cabeçalho de colunas e cada linha. Toda track numérica tem
 * largura fixa (é o que mantém os números na mesma coluna em todas as linhas) e a única track
 * elástica é `minmax(0,1fr)` — o `0` é o que permite o `truncate` dos filhos.
 *
 * Ordem no DOM: produto · SKUs · saldo · situação · canais · ação.
 * Abaixo de `md` as células 2/4/5 ficam `hidden`, sobrando exatamente 3 itens para 3 tracks.
 */
export const GRID_LINHA_PRODUTO =
  'grid items-center gap-x-2 grid-cols-[minmax(0,1fr)_3.25rem_5.5rem] md:gap-x-3 md:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_8rem_8rem_19rem]';

const CELULA_MD = 'hidden md:block';

/** Cabeçalho de colunas da lista — é o que faz a lista ler como planilha de conferência. */
export function CabecalhoProdutos() {
  return (
    <div
      className={cn(
        GRID_LINHA_PRODUTO,
        'px-3 pb-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground',
      )}
    >
      <span className="pl-7">Produto</span>
      <span className={cn(CELULA_MD, 'text-right')}>SKUs</span>
      <span className="text-right">Saldo</span>
      <span className={cn(CELULA_MD)}>Situação</span>
      <span className={cn(CELULA_MD)}>Canais</span>
      <span aria-hidden />
    </div>
  );
}

function CelulaSaldo({ saldo }: { saldo: number }) {
  return (
    <div className={cn(
      'text-right text-sm font-semibold tabular-nums tracking-tight',
      saldo <= 0 && 'font-normal text-muted-foreground',
    )}>
      {saldo}
    </div>
  );
}

export function ProdutoCard({
  produto, canais, onDarEntrada, onAjustar, onExcluir, onAdicionarVariacao, statusUpdate,
  onPreencherFiscal, fiscalPendente,
}: {
  produto: ProdutoEstoqueResumo;
  canais: string[];
  onDarEntrada: (alvo: AlvoEntrada) => void;
  onAjustar?: (produto: ProdutoComSaldo) => void;
  onExcluir?: (produto: ProdutoEstoqueResumo) => void;
  /** ADR-0129 D-7: admin-only — a página só passa esta prop para admin (esconder o botão é
   *  navegação, não fronteira de segurança; o gate real vive na edge). */
  onAdicionarVariacao?: (produto: ProdutoEstoqueResumo) => void;
  /** ADR-0129 D-11: família UPDATE mais recente deste produto (lib estoque-update-status.ts). */
  statusUpdate?: 'atualizando' | 'erro';
  /** ADR-0135 D-9: abre o DialogFiscalProduto (T13) para esta família. Só a página passa esta
   *  prop quando a org tem o módulo fiscal — o botão em si só some quando `fiscalPendente` é
   *  false (ou a família não tem `familiaId`, ex.: fixture antigo de teste). */
  onPreencherFiscal?: (produto: ProdutoEstoqueResumo) => void;
  /** Calculado pela página (`produtoFiscalPendente`, depende do regime tributário da org — não
   *  é um campo do resumo). Fix round 1 (I1): deixou de vir embutido no `produto`. */
  fiscalPendente?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const { data: capaUrl } = useImageUrl(produto.capaStoragePath);
  const capa = capaUrl ?? urlFotoMl(produto.capaMlPictureId);

  const { data: variacoes, isLoading: variacoesLoading } = useQuery({
    queryKey: QK.variacoesEstoque(produto.codigoPai),
    queryFn: () => fetchVariacoesProduto(produto.codigoPai),
    enabled: aberto,
    staleTime: 30_000,
  });

  // Pedido do Diego (2026-08-21): badge por linha (Publicado/Erro/Publicando) nas variações da
  // última submissão de "Adicionar variação". `queryFn` nunca roda de verdade — o marcador só
  // chega via `qc.setQueryData` no dialog; `staleTime: Infinity` evita que o useQuery dispare a
  // queryFn (que apagaria o marcador com `[]`) toda vez que o card reabre.
  const { data: recemAdicionadas } = useQuery({
    queryKey: QK.variacoesRecemAdicionadas(produto.codigoPai),
    queryFn: (): string[] => [],
    staleTime: Infinity,
  });
  const recemAdicionadasSet = useMemo(() => new Set(recemAdicionadas ?? []), [recemAdicionadas]);
  const statusPublicacao = (codigo: string): StatusPublicacaoLinha =>
    (recemAdicionadasSet.has(codigo) ? (statusUpdate ?? 'publicado') : undefined);

  // Preço vivo do canal, só com o card aberto (a chamada varre todos os anúncios da org). A
  // lista NUNCA espera por ele: enquanto não chega, cada linha mostra o preço local.
  const { data: statusPublicados } = useStatusPublicados({ enabled: aberto });
  const precoMlPorItem = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of statusPublicados?.itens ?? []) {
      if (i.preco != null) mapa.set(i.ml_item_id, i.preco);
    }
    return mapa;
  }, [statusPublicados]);
  const precoMl = (v: VariacaoComSaldo) =>
    (v.mlItemId ? precoMlPorItem.get(v.mlItemId) ?? null : null);

  const alvo: AlvoEntrada = produto.qtdSkus === 1 && produto.skuUnico
    ? { sku: produto.skuUnico, codigoPai: produto.codigoPai }
    : { codigoPai: produto.codigoPai };

  async function handleAjustar() {
    if (!onAjustar) return;
    const vars = variacoes ?? await fetchVariacoesProduto(produto.codigoPai);
    onAjustar(mergeProdutoComVariacoes(produto, vars));
  }

  return (
    <div className={cn(
      'rounded-lg border bg-card transition-colors hover:bg-muted/40',
      aberto && 'bg-muted/40 ring-1 ring-primary/25',
    )}>
      <div className={cn(GRID_LINHA_PRODUTO, 'px-3 py-2')}>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painelId}
          onClick={() => setAberto((v) => !v)}
          className="flex min-w-0 items-center gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
          <FotoCapaFamilia capaUrl={capa} tamanho="small" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium leading-tight">{produto.nomePai}</div>
            <div className="truncate font-mono text-xs leading-tight text-muted-foreground">{produto.codigoPai}</div>
            {/* ADR-0129 D-11: sinaliza o lote de "Adicionar variação" desta tela mesmo antes de
                expandir o card — pareado com o sino de notificação no fim do processamento. */}
            {statusUpdate && (
              <div className={cn(
                'truncate text-xs leading-tight',
                statusUpdate === 'atualizando' ? 'text-amber-600 dark:text-amber-500' : 'text-destructive',
              )}>
                {statusUpdate === 'atualizando' ? 'Atualizando…' : 'Erro na última atualização'}
              </div>
            )}
          </div>
        </button>

        <div className={cn(CELULA_MD, 'text-right text-sm tabular-nums text-muted-foreground')}>
          {produto.qtdSkus}
        </div>

        <CelulaSaldo saldo={produto.saldoTotal} />

        <div className={CELULA_MD}>
          <PillSaldo saldo={produto.saldoTotal} />
        </div>

        <div className={cn(CELULA_MD, 'min-w-0')}>
          {canais.length > 0 && (
            <div className="flex min-w-0 items-center gap-1">
              <CanalBadge canal={canais[0]} className="min-w-0 max-w-full overflow-hidden" />
              {canais.length > 1 && (
                <span className="shrink-0 text-xs text-muted-foreground">+{canais.length - 1}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex min-w-0 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-9 min-w-0 flex-1 px-2 md:h-7"
            aria-label={`Dar entrada em ${produto.nomePai}`}
            onClick={() => onDarEntrada(alvo)}
          >
            <PackagePlus className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden truncate md:inline">Entrada</span>
          </Button>
          {onAjustar && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-0 flex-1 px-2 md:h-7"
              aria-label={`Ajustar estoque de ${produto.nomePai}`}
              onClick={() => void handleAjustar()}
            >
              <PackageMinus className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden truncate md:inline">Ajustar</span>
            </Button>
          )}
          {onPreencherFiscal && fiscalPendente && produto.familiaId && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-0 flex-1 px-2 md:h-7"
              aria-label={`Preencher fiscal de ${produto.nomePai}`}
              onClick={() => onPreencherFiscal(produto)}
            >
              <Receipt className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden truncate md:inline">Fiscal</span>
            </Button>
          )}
          {(onExcluir || onAdicionarVariacao) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden shrink-0 px-0 md:flex md:h-7 md:w-7"
                  aria-label={`Mais ações para ${produto.nomePai}`}
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {onAdicionarVariacao && (
                  <>
                    <DropdownMenuItem
                      disabled={produto.mlItemId == null}
                      onSelect={() => onAdicionarVariacao(produto)}
                    >
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      Adicionar variação
                    </DropdownMenuItem>
                    {produto.mlItemId == null && (
                      <p className="px-2 pb-1.5 pt-0.5 text-xs text-muted-foreground">
                        Disponível após publicar no ML.
                      </p>
                    )}
                  </>
                )}
                {onExcluir && (
                  <>
                    <DropdownMenuItem
                      disabled={produto.mlItemId != null}
                      onSelect={() => onExcluir(produto)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Excluir produto
                    </DropdownMenuItem>
                    {produto.mlItemId != null && (
                      <p className="px-2 pb-1.5 pt-0.5 text-xs text-muted-foreground">
                        Publicado — remova pela tela Publicados primeiro.
                      </p>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {aberto && (
        <div id={painelId} className="border-t px-3 py-3">
          <Tabs defaultValue="variacoes">
            <TabsList>
              <TabsTrigger value="variacoes">Variações ({produto.qtdSkus})</TabsTrigger>
              <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
            </TabsList>
            <TabsContent value="variacoes">
              <div className="overflow-hidden rounded-lg border bg-background">
                <CabecalhoVariacoes />
                {variacoesLoading ? (
                  <div className="space-y-2 p-3">
                    {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : (() => {
                  const lista = variacoes ?? [];
                  if (lista.length <= VARIACOES_VIRTUAL_THRESHOLD) {
                    return (
                      <div className="[&>*:last-child]:border-b-0">
                        {lista.map((v) => (
                          <VariacaoEstoqueLinha
                            key={v.codigo}
                            variacao={v}
                            precoMl={precoMl(v)}
                            statusPublicacao={statusPublicacao(v.codigo)}
                          />
                        ))}
                      </div>
                    );
                  }
                  return (
                    <ListaVariacoesEstoque
                      variacoes={lista}
                      nomeProduto={produto.nomePai}
                      precoMl={precoMl}
                      statusPublicacao={statusPublicacao}
                    />
                  );
                })()}
              </div>
            </TabsContent>
            <TabsContent value="movimentos">
              <MovimentosEstoque
                codigoPai={produto.codigoPai}
                ativo={aberto}
                variacoes={(variacoes ?? []).map((v) => ({ codigo: v.codigo, cor: v.cor }))}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
