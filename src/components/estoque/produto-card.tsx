// Linha de produto da tela Estoque. Substitui a <TableRow>: o painel expandido é filho do card,
// FORA de qualquer <table> — é isso que impede o min-content de tabela aninhada de estourar a
// largura da página (o bug que motivou o redesenho).
import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CanalBadge } from '@/components/canal-badge';
import { FotoCapaFamilia } from '@/components/foto-capa-familia';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { VariacaoEstoqueCard, PillSaldo } from '@/components/estoque/variacao-estoque-card';
import { useImageUrl } from '@/hooks/useImageUrl';
import { cn } from '@/lib/utils';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

export interface AlvoEntrada {
  /** Só preenchido quando o produto tem UMA variação — com várias, a escolha é do operador. */
  sku?: string;
  codigoPai: string;
}

export function ProdutoCard({ produto, canais, onDarEntrada }: {
  produto: ProdutoComSaldo;
  canais: string[];
  onDarEntrada: (alvo: AlvoEntrada) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const painelId = useId();
  const { data: capaUrl } = useImageUrl(produto.capaStoragePath);

  const alvo: AlvoEntrada = produto.variacoes.length === 1
    ? { sku: produto.variacoes[0].codigo, codigoPai: produto.codigoPai }
    : { codigoPai: produto.codigoPai };

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 p-3">
        {/* Botão real, não div com onClick: a expansão precisa funcionar por teclado. */}
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={painelId}
          onClick={() => setAberto((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
          <FotoCapaFamilia capaUrl={capaUrl ?? null} tamanho="small" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{produto.nomePai}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{produto.codigoPai}</div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="tabular-nums font-medium">{produto.saldoTotal}</div>
            <div className="hidden text-xs text-muted-foreground sm:block">
              {produto.variacoes.length} {produto.variacoes.length === 1 ? 'SKU' : 'SKUs'}
            </div>
          </div>
          <PillSaldo saldo={produto.saldoTotal} />
          {canais.length > 0 && (
            <div className="hidden flex-wrap gap-1 md:flex">
              {canais.map((c) => <CanalBadge key={c} canal={c} />)}
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDarEntrada(alvo)}>
            Dar entrada
          </Button>
        </div>
      </div>

      {aberto && (
        <div id={painelId} className="border-t bg-muted/40 p-3">
          {produto.descricaoPai && (
            <p className="mb-3 line-clamp-3 text-xs text-muted-foreground">{produto.descricaoPai}</p>
          )}
          <Tabs defaultValue="variacoes">
            <TabsList>
              <TabsTrigger value="variacoes">Variações</TabsTrigger>
              <TabsTrigger value="movimentos">Movimentos</TabsTrigger>
            </TabsList>
            <TabsContent value="variacoes">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {produto.variacoes.map((v) => <VariacaoEstoqueCard key={v.codigo} variacao={v} />)}
              </div>
            </TabsContent>
            <TabsContent value="movimentos">
              <MovimentosEstoque codigoPai={produto.codigoPai} ativo={aberto} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
