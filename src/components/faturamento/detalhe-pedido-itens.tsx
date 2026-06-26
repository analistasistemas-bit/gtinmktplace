import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import type { Pedido } from '@/lib/pedidos-faturamento';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { ThumbProduto } from './pilha-thumbs';

/** Formata markup como percentual com sinal. Ex: 0.42 → "+42%" */
function fmtMarkup(m: number): string {
  const pct = Math.round(m * 100);
  return (pct >= 0 ? '+' : '') + pct + '%';
}

/**
 * Conteúdo expansível de um pedido (linha aberta): meta (pedido/pack, comissão, frete, rastreio),
 * tabela de itens com custo/líquido/markup por item, e link p/ o Mercado Livre. Compartilhado entre
 * o menu Faturamento e o Detalhe do líquido (Financeiro) — mesma análise detalhada nos dois.
 */
export function DetalhePedidoItens({ pedido: p }: { pedido: Pedido }) {
  const urlVenda = p.isPack
    ? `https://www.mercadolivre.com.br/vendas/pacote/${p.chave}/detalhe`
    : `https://www.mercadolivre.com.br/vendas/${p.orderIds[0]}/detalhe`;
  return (
    <div className="px-10 py-3">
      <div className="mb-2 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          {p.isPack
            ? <>Pack <span className="font-medium text-foreground tabular-nums">{p.chave}</span></>
            : <>Pedido <span className="font-medium text-foreground tabular-nums">{p.orderIds[0]}</span></>}
        </div>
        <div>Comissão ML <span className="font-medium text-foreground tabular-nums">{fmtBRL(p.comissao)}</span></div>
        <div>Frete vendedor <span className="font-medium text-foreground tabular-nums">{p.frete != null ? fmtBRL(p.frete) : '—'}</span></div>
        <div>Rastreio <span className="font-medium text-foreground">{p.rastreio ?? '—'}</span></div>
      </div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Cor</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>EAN</TableHead>
            <TableHead className="text-right">Qtd</TableHead>
            <TableHead className="text-right">Preço un.</TableHead>
            <TableHead className="text-right">Custo</TableHead>
            <TableHead className="text-right">Líquido</TableHead>
            <TableHead className="text-right">Markup</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {p.itens.map((it) => {
            const mCor = it.markup == null ? undefined
              : it.markup >= 0 ? 'text-success' : 'text-destructive';
            return (
              <TableRow key={it.id}>
                <TableCell className="max-w-[280px] uppercase" title={it.titulo ?? ''}>
                  <span className="flex items-center gap-2">
                    <ThumbProduto path={it.imagem_path} titulo={it.titulo} size={28} />
                    <span className="truncate">{it.titulo ?? '—'}</span>
                  </span>
                </TableCell>
                <TableCell>{it.cor ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{it.codigo ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{it.ean ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtBRL(it.unit_price)}</TableCell>
                <TableCell className="text-right tabular-nums">{it.custo != null ? fmtBRL(it.custo) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-success">{fmtBRL(it.liquido)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', mCor)}>
                  {it.markup != null ? fmtMarkup(it.markup) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="mt-2">
        <a href={urlVenda} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
          Ver no Mercado Livre <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
