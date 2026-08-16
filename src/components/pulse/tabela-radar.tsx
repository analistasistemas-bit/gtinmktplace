// Pulse (ADR-0119): lista de produtos no radar — menor preço/nº de ofertas vêm de um resumo
// derivado de pulse_ofertas (estadoAtualOfertas), separado da lista de produtos em si.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MoreVertical, Pause, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchPulseResumoOfertas, pausarPulseProduto, type PulseProduto } from '@/lib/pulse';
import { fmtBRL } from '@/lib/formato';

// Escala do "preço para ganhar" do ML, do mais barato ao mais caro. Status fora desta lista cai no
// texto cru — preferimos mostrar o código do ML a inventar uma tradução para algo não observado.
const PTW_LABEL: Record<string, { texto: string; variant?: 'destructive' | 'secondary' | 'outline' }> = {
  with_benchmark_lowest: { texto: 'Menor preço do mercado', variant: 'secondary' },
  with_benchmark_low: { texto: 'Abaixo da média', variant: 'secondary' },
  with_benchmark_mid: { texto: 'Na média do mercado', variant: 'outline' },
  with_benchmark_high: { texto: 'Acima da média', variant: 'destructive' },
  with_benchmark_highest: { texto: 'Preço mais alto', variant: 'destructive' },
  sharing_first_place: { texto: 'Dividindo o 1º lugar', variant: 'secondary' },
  no_benchmark_lowest: { texto: 'Sem concorrência direta', variant: 'outline' },
  no_benchmark: { texto: 'Sem referência do ML', variant: 'outline' },
};

function relativo(iso: string | null): string {
  if (!iso) return 'nunca coletado';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'agora mesmo';
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
  const { data: resumo } = useQuery({
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

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 text-xs text-muted-foreground hover:bg-muted/50">
          <TableHead>Produto</TableHead>
          <TableHead>Origem</TableHead>
          <TableHead className="text-right">Menor preço</TableHead>
          <TableHead className="text-right">Ofertas</TableHead>
          <TableHead>Price-to-win</TableHead>
          <TableHead>Última coleta</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {produtos.map((p) => {
          const r = resumo?.get(p.id);
          const ptw = p.ptw_status ? (PTW_LABEL[p.ptw_status] ?? { texto: p.ptw_status }) : null;
          return (
            <TableRow
              key={p.id}
              className="cursor-pointer"
              onClick={() => onAbrirDetalhe(p.id)}
            >
              <TableCell className="max-w-[320px]">
                <span className="block truncate font-medium">{p.titulo ?? p.catalog_product_id}</span>
                {/* EAN da ficha (cada catalog_product_id é uma cor); sem GTIN cadastrado, cai no
                    código da família para o operador ainda conseguir localizar o produto. */}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {p.gtin ?? p.codigo_pai ?? '—'}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={p.origem === 'manual' ? 'secondary' : 'outline'}>
                  {p.origem === 'manual' ? 'Manual' : 'Auto'}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r?.menorPreco != null ? fmtBRL(r.menorPreco) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">{r?.nOfertas ?? '—'}</TableCell>
              <TableCell>
                {ptw ? <Badge variant={ptw.variant ?? 'outline'}>{ptw.texto}</Badge> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{relativo(p.ultimo_snapshot_em)}</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 px-0" aria-label={`Mais ações para ${p.titulo ?? p.catalog_product_id}`}>
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
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
