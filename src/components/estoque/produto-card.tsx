// Linha de produto da tela Estoque. Não existe <table> nesta tela (guarda em Estoque.test.tsx):
// o painel expandido é filho da linha e o min-content de tabela aninhada estourava a largura da
// página. O alinhamento de colunas vem de CSS Grid com tracks FIXOS — grid não dimensiona track
// por conteúdo do jeito que a tabela dimensiona, então GTIN/nome longo não empurra nada.
import { useId, useState } from 'react';
import { ChevronRight, MoreVertical, PackageMinus, PackagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalBadge } from '@/components/canal-badge';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { VariacaoEstoqueLinha, CabecalhoVariacoes, PillSaldo } from '@/components/estoque/variacao-estoque-linha';
import { useImageUrl } from '@/hooks/useImageUrl';
import { cn } from '@/lib/utils';
import { urlFotoMl, type ProdutoComSaldo } from '@/lib/produtos-saldo';

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
// A última coluna é a das ações e cabe DUAS (Entrada + Ajustar, ADR-0110). Dimensionada para
// uma só, o segundo botão vazava para fora da viewport — a linha não tem overflow que o segure.
// A partir de `md` cabe também o menu ⋮ (ADR-0113): 12.5rem → 15rem, largura fixa de 2.25rem
// fora do `flex-1` dos outros dois. A track MOBILE fica intacta de propósito — medido em 375px,
// abrir espaço para um terceiro botão derrubava o nome do produto de 81px para 49px de texto
// ("Crem…"). Por isso o menu não é renderizado abaixo de `md`.
export const GRID_LINHA_PRODUTO =
  'grid items-center gap-x-2 grid-cols-[minmax(0,1fr)_3.25rem_5.5rem] md:gap-x-3 md:grid-cols-[minmax(0,1fr)_3.5rem_5.5rem_8rem_8rem_15rem]';

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
      <span className={CELULA_MD}>Situação</span>
      <span className={CELULA_MD}>Canais</span>
      {/* Célula vazia da coluna de ação. NÃO usar `sr-only`: ele é `position:absolute` e tira o
          item do fluxo do grid, desalinhando os rótulos das colunas. */}
      <span aria-hidden />
    </div>
  );
}

/**
 * Saldo em escala de peso tipográfico em vez de número solto: saldo zerado/negativo perde o
 * destaque (o pill da coluna Situação é quem fala) e saldo saudável fica cheio.
 *
 * Uma micro-barra proporcional ao maior saldo foi testada e cortada: com o número alinhado à
 * direita e a barra crescendo da esquerda, ela lia como um sublinhado deslocado — ruído, não
 * sinal. Ordenar por "Menor saldo" resolve a mesma pergunta sem enfeite.
 */
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

export function ProdutoCard({ produto, canais, onDarEntrada, onAjustar, onExcluir }: {
  produto: ProdutoComSaldo;
  canais: string[];
  onDarEntrada: (alvo: AlvoEntrada) => void;
  /** ADR-0110: ajuste/zeragem é admin-only — a página só passa isto para admin. */
  onAjustar?: (produto: ProdutoComSaldo) => void;
  /** ADR-0113: exclusão é admin-only, mesma regra do ajuste. */
  onExcluir?: (produto: ProdutoComSaldo) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const { data: capaUrl } = useImageUrl(produto.capaStoragePath);
  // Storage primeiro; na falta dele, a foto do próprio anúncio no ML (a maioria dos produtos
  // de planilha não tem imagem no Storage, só `ml_picture_id`).
  const capa = capaUrl ?? urlFotoMl(produto.capaMlPictureId);

  const alvo: AlvoEntrada = produto.variacoes.length === 1
    ? { sku: produto.variacoes[0].codigo, codigoPai: produto.codigoPai }
    : { codigoPai: produto.codigoPai };

  return (
    <div className={cn(
      'rounded-lg border bg-card transition-colors hover:bg-muted/40',
      aberto && 'bg-muted/40 ring-1 ring-primary/25',
    )}>
      <div className={cn(GRID_LINHA_PRODUTO, 'px-3 py-2')}>
        {/* Botão real, não div com onClick: a expansão precisa funcionar por teclado. */}
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
          </div>
        </button>

        <div className={cn(CELULA_MD, 'text-right text-sm tabular-nums text-muted-foreground')}>
          {produto.variacoes.length}
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

        {/* `flex-1 min-w-0`, nunca `w-full`: dois filhos com w-full pedem 100% CADA um da
            coluna e o segundo vaza para fora da tela. */}
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
              onClick={() => onAjustar(produto)}
            >
              <PackageMinus className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden truncate md:inline">Ajustar</span>
            </Button>
          )}
          {onExcluir && (
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
              {/* Largura explícita: sem ela o menu herda o `min-w` do trigger (um botão de ícone)
                  e "Excluir produto" quebra em duas linhas. */}
              <DropdownMenuContent align="end" className="w-52">
                {/* `mlItemId` é a fonte canônica de publicado (a lista de canais é espelho e pode
                    estar furada). Aqui é só para não gastar a ida — quem recusa de fato é a edge,
                    que varre TODAS as irmãs do codigo_pai, não só a linha mais recente. */}
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {aberto && (
        <div id={painelId} className="border-t px-3 py-3">
          <Tabs defaultValue="variacoes">
            <TabsList>
              <TabsTrigger value="variacoes">Variações ({produto.variacoes.length})</TabsTrigger>
              <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
            </TabsList>
            <TabsContent value="variacoes">
              <div className="overflow-hidden rounded-lg border bg-background">
                <CabecalhoVariacoes />
                {produto.variacoes.map((v) => <VariacaoEstoqueLinha key={v.codigo} variacao={v} />)}
              </div>
            </TabsContent>
            <TabsContent value="movimentos">
              <MovimentosEstoque
                codigoPai={produto.codigoPai}
                ativo={aberto}
                variacoes={produto.variacoes.map((v) => ({ codigo: v.codigo, cor: v.cor }))}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
