// E6b (ADR-0094): tela do módulo Estoque — saldo por produto, entrada de mercadoria e
// trilha de auditoria dos movimentos.
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, ChevronRight, Plus, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CanalBadge } from '@/components/canal-badge';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { DialogEntrada } from '@/components/estoque/dialog-entrada';
import { DialogCadastroProduto } from '@/components/estoque/dialog-cadastro-produto';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { cn } from '@/lib/utils';
import { fmtBRL } from '@/lib/formato';
import {
  fetchProdutosComSaldo, fetchCanaisPorProduto, type ProdutoComSaldo, type VariacaoComSaldo,
} from '@/lib/produtos-saldo';

/** "200g · 10×20×30cm", só as partes informadas. "—" se nada foi preenchido. */
function rotuloDimensoes(v: VariacaoComSaldo): string {
  const partes: string[] = [];
  if (v.pesoGramas != null) partes.push(`${v.pesoGramas}g`);
  const { alturaCm: a, larguraCm: l, comprimentoCm: c } = v;
  if (a != null || l != null || c != null) partes.push(`${a ?? '—'}×${l ?? '—'}×${c ?? '—'}cm`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

function LinhaProduto({ produto, canais, onDarEntrada }: {
  produto: ProdutoComSaldo;
  canais: string[];
  onDarEntrada: (sku: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const zerado = produto.saldoTotal === 0;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setAberto((v) => !v)}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-90')} />
            <div className="min-w-0">
              <div className="truncate">{produto.nomePai}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{produto.codigoPai}</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
          {produto.variacoes.length}
        </TableCell>
        <TableCell>
          <span className={cn('tabular-nums font-medium', zerado && 'text-destructive')}>
            {produto.saldoTotal}
          </span>
          {/* Saldo zero: o anúncio fica pausado no ML até entrar mercadoria. */}
          {zerado && <span className="ml-2 text-xs text-destructive">sem estoque</span>}
        </TableCell>
        <TableCell className="hidden md:table-cell">
          {canais.length === 0
            ? <span className="text-muted-foreground">—</span>
            : <div className="flex flex-wrap gap-1">{canais.map((c) => <CanalBadge key={c} canal={c} />)}</div>}
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); onDarEntrada(produto.variacoes[0]?.codigo ?? ''); }}
          >
            Dar entrada
          </Button>
        </TableCell>
      </TableRow>

      {aberto && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-muted/40 p-3">
            <div className="flex flex-col gap-3">
              <div className="overflow-x-auto rounded-lg border bg-background p-3 shadow-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variações</span>
                {/* Descrição é do produto (familias.descricao_pai), não da variação — uma linha só. */}
                {produto.descricaoPai && (
                  <p className="mt-1 text-xs text-muted-foreground">{produto.descricaoPai}</p>
                )}
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-1 pr-3 font-medium">SKU</th>
                      <th className="pb-1 pr-3 font-medium">Cor / nome</th>
                      <th className="pb-1 pr-3 font-medium">GTIN</th>
                      <th className="pb-1 pr-3 font-medium">Dimensões</th>
                      <th className="pb-1 pr-3 text-right font-medium">Saldo</th>
                      <th className="pb-1 pr-3 text-right font-medium">Custo</th>
                      <th className="pb-1 text-right font-medium">Preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {produto.variacoes.map((v) => (
                      <tr key={v.codigo} className="border-t border-border/50">
                        <td className="py-1 pr-3 whitespace-nowrap font-mono">{v.codigo}</td>
                        <td className="py-1 pr-3">{v.cor ?? v.nome ?? '—'}</td>
                        <td className="py-1 pr-3 whitespace-nowrap font-mono text-muted-foreground">{v.gtin ?? '—'}</td>
                        <td className="py-1 pr-3 whitespace-nowrap text-muted-foreground">{rotuloDimensoes(v)}</td>
                        <td className={cn('py-1 pr-3 text-right tabular-nums', v.estoque === 0 && 'text-destructive')}>
                          {v.estoque}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                          {v.custo != null ? fmtBRL(Number(v.custo)) : '—'}
                        </td>
                        <td className="py-1 text-right tabular-nums">{fmtBRL(Number(v.preco))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <MovimentosEstoque codigoPai={produto.codigoPai} ativo={aberto} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function Estoque() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const [busca, setBusca] = useState('');
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [skuInicial, setSkuInicial] = useState<string | undefined>();
  const [cadastroAberto, setCadastroAberto] = useState(false);

  const { data: produtos, isLoading, isError } = useQuery({
    queryKey: ['produtos-saldo'],
    queryFn: fetchProdutosComSaldo,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 30_000,
  });
  const { data: canaisPorProduto } = useQuery({
    queryKey: ['canais-por-produto'],
    queryFn: fetchCanaisPorProduto,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 60_000,
  });

  // Esconder o menu NÃO protege a rota — URL direta renderiza a tela. A escrita já está
  // protegida pelas edges (403); isto é coerência de navegação.
  if (modulosLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!modulos?.includes('estoque')) return <Navigate to="/" replace />;

  const termo = busca.trim().toLowerCase();
  const lista = (produtos ?? []).filter((p) => !termo
    || p.nomePai.toLowerCase().includes(termo)
    || p.codigoPai.toLowerCase().includes(termo)
    || p.variacoes.some((v) => v.codigo.toLowerCase().includes(termo)));

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Estoque"
        subtitle="Saldo por produto, entrada de mercadoria e histórico de movimentos."
        actions={
          <>
            <Button variant="outline" onClick={() => { setSkuInicial(undefined); setEntradaAberta(true); }}>
              <PackagePlus className="mr-2 h-4 w-4" />
              Dar entrada
            </Button>
            <Button onClick={() => setCadastroAberto(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Cadastrar produto
            </Button>
          </>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">carregando produtos…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">não foi possível carregar os produtos.</p>
      ) : (produtos ?? []).length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Nenhum produto cadastrado ainda."
          description="Comece cadastrando o primeiro."
          action={<Button onClick={() => setCadastroAberto(true)}>Cadastrar produto</Button>}
        />
      ) : (
        <>
          <div className="mb-3 max-w-sm">
            <Input
              placeholder="Buscar por produto ou SKU…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="hidden md:table-cell">SKUs</TableHead>
                  <TableHead>Saldo total</TableHead>
                  <TableHead className="hidden md:table-cell">Canais</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <LinhaProduto
                    key={p.codigoPai}
                    produto={p}
                    canais={canaisPorProduto?.get(p.codigoPai) ?? []}
                    onDarEntrada={(sku) => { setSkuInicial(sku); setEntradaAberta(true); }}
                  />
                ))}
              </TableBody>
            </Table>
            {lista.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Nenhum produto bate com “{busca}”.</p>
            )}
          </div>
        </>
      )}

      <DialogEntrada
        produtos={produtos ?? []}
        aberto={entradaAberta}
        onFechar={() => setEntradaAberta(false)}
        skuInicial={skuInicial}
      />
      <DialogCadastroProduto
        aberto={cadastroAberto}
        onFechar={() => setCadastroAberto(false)}
      />
    </div>
  );
}
