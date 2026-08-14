// E6b (ADR-0094): tela do módulo Estoque — saldo por produto, entrada de mercadoria e
// trilha de auditoria dos movimentos.
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Boxes, Plus, PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DialogEntrada } from '@/components/estoque/dialog-entrada';
import { DialogAjuste } from '@/components/estoque/dialog-ajuste';
import { DialogCadastroProduto } from '@/components/estoque/dialog-cadastro-produto';
import { DialogExcluirProduto } from '@/components/estoque/dialog-excluir-produto';
import { ProdutoCard, CabecalhoProdutos, type AlvoEntrada } from '@/components/estoque/produto-card';
import { BarraFiltrosEstoque } from '@/components/estoque/barra-filtros-estoque';
import { ResumoEstoqueKpis } from '@/components/estoque/resumo-estoque';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { filtrarProdutos, canaisEfetivos, type FiltroEstoque, type OrdemEstoque } from '@/lib/produtos-saldo-filtro';
import { QK } from '@/lib/queries';
import {
  fetchProdutosEstoqueResumo, fetchCanaisPorProduto,
  type ProdutoComSaldo, type ProdutoEstoqueResumo,
} from '@/lib/produtos-saldo';
import { useProfile } from '@/hooks/useProfile';
import type { ResumoEstoque } from '@/lib/produtos-saldo-resumo';

const RESUMO_VAZIO: ResumoEstoque = {
  produtos: 0, skus: 0, unidades: 0, skusSemEstoque: 0, valorEmEstoque: 0, skusSemCusto: 0,
};

export default function Estoque() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroEstoque>('todos');
  const [ordem, setOrdem] = useState<OrdemEstoque>('nome');
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [alvoEntrada, setAlvoEntrada] = useState<AlvoEntrada | null>(null);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const { isAdmin } = useProfile();
  const [produtoAjuste, setProdutoAjuste] = useState<ProdutoComSaldo | null>(null);
  const [produtoExcluir, setProdutoExcluir] = useState<ProdutoEstoqueResumo | null>(null);

  const { data: estoque, isLoading, isError } = useQuery({
    queryKey: QK.produtosEstoqueResumo,
    queryFn: fetchProdutosEstoqueResumo,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 180_000,
  });

  const produtos = estoque?.produtos ?? [];
  const resumo = estoque?.kpis ?? RESUMO_VAZIO;

  const {
    data: canaisPorProduto, isLoading: canaisLoading, isError: canaisErro,
  } = useQuery({
    queryKey: QK.canaisPorProduto,
    queryFn: fetchCanaisPorProduto,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 120_000,
  });
  const canaisIndisponivel = canaisLoading || canaisErro;

  useEffect(() => {
    if (canaisIndisponivel && filtro === 'nao-publicado') {
      setFiltro('todos');
      if (canaisErro) {
        toast.error('Filtro "Não publicado" desativado: falha ao carregar os canais.');
      }
    }
  }, [canaisIndisponivel, canaisErro, filtro]);

  if (modulosLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!modulos?.includes('estoque')) return <Navigate to="/" replace />;

  const filtroEfetivo = canaisIndisponivel && filtro === 'nao-publicado' ? 'todos' : filtro;

  const lista = filtrarProdutos(produtos, {
    termo: busca, filtro: filtroEfetivo, ordem,
    canaisPorProduto: canaisIndisponivel ? undefined : canaisPorProduto,
  });

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Estoque"
        subtitle="Saldo por produto, entrada de mercadoria e histórico de movimentos."
        actions={
          <>
            <Button variant="outline" onClick={() => { setAlvoEntrada(null); setEntradaAberta(true); }}>
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
        <>
          <ResumoEstoqueKpis resumo={resumo} carregando />
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        </>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">não foi possível carregar os produtos.</p>
      ) : produtos.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Nenhum produto cadastrado ainda."
          description="Comece cadastrando o primeiro."
          action={<Button onClick={() => setCadastroAberto(true)}>Cadastrar produto</Button>}
        />
      ) : (
        <>
          <ResumoEstoqueKpis resumo={resumo} />
          <BarraFiltrosEstoque
            termo={busca} filtro={filtro} ordem={ordem}
            canaisCarregando={canaisLoading} canaisErro={canaisErro}
            onTermo={setBusca} onFiltro={setFiltro} onOrdem={setOrdem}
          />
          {lista.length > 0 && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {lista.length === produtos.length
                  ? `${lista.length} ${lista.length === 1 ? 'produto' : 'produtos'}`
                  : `${lista.length} de ${produtos.length} produtos`}
              </p>
              <CabecalhoProdutos />
            </>
          )}
          <div className="flex flex-col gap-1.5">
            {lista.map((p) => (
              <ProdutoCard
                key={p.codigoPai}
                produto={p}
                canais={canaisEfetivos(p, canaisPorProduto)}
                onDarEntrada={(alvo) => { setAlvoEntrada(alvo); setEntradaAberta(true); }}
                onAjustar={isAdmin ? setProdutoAjuste : undefined}
                onExcluir={isAdmin ? setProdutoExcluir : undefined}
              />
            ))}
            {lista.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {busca.trim() !== ''
                  ? `Nenhum produto bate com “${busca}”.`
                  : 'Nenhum produto encontrado com o filtro selecionado.'}
              </p>
            )}
          </div>
        </>
      )}

      <DialogEntrada
        aberto={entradaAberta}
        onFechar={() => setEntradaAberta(false)}
        skuInicial={alvoEntrada?.sku}
        filtroInicial={alvoEntrada?.codigoPai}
      />
      <DialogAjuste
        produto={produtoAjuste}
        aberto={produtoAjuste != null}
        onFechar={() => setProdutoAjuste(null)}
      />
      <DialogExcluirProduto
        produto={produtoExcluir}
        aberto={produtoExcluir != null}
        onFechar={() => setProdutoExcluir(null)}
      />
      <DialogCadastroProduto
        aberto={cadastroAberto}
        onFechar={() => setCadastroAberto(false)}
      />
    </div>
  );
}
