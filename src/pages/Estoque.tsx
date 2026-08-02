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
import { DialogCadastroProduto } from '@/components/estoque/dialog-cadastro-produto';
import { ProdutoCard, type AlvoEntrada } from '@/components/estoque/produto-card';
import { BarraFiltrosEstoque } from '@/components/estoque/barra-filtros-estoque';
import { useModulosHabilitados } from '@/hooks/useModulosHabilitados';
import { filtrarProdutos, type FiltroEstoque, type OrdemEstoque } from '@/lib/produtos-saldo-filtro';
import { fetchProdutosComSaldo, fetchCanaisPorProduto } from '@/lib/produtos-saldo';

export default function Estoque() {
  const { data: modulos, isLoading: modulosLoading } = useModulosHabilitados();
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroEstoque>('todos');
  const [ordem, setOrdem] = useState<OrdemEstoque>('nome');
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [alvoEntrada, setAlvoEntrada] = useState<AlvoEntrada | null>(null);
  const [cadastroAberto, setCadastroAberto] = useState(false);

  const { data: produtos, isLoading, isError } = useQuery({
    queryKey: ['produtos-saldo'],
    queryFn: fetchProdutosComSaldo,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 30_000,
  });

  // isLoading/isError explícitos: `data === undefined` sozinho confunde "carregando" com "falhou",
  // e o filtro por publicação depende dessa diferença.
  const {
    data: canaisPorProduto, isLoading: canaisLoading, isError: canaisErro,
  } = useQuery({
    queryKey: ['canais-por-produto'],
    queryFn: fetchCanaisPorProduto,
    enabled: !!modulos?.includes('estoque'),
    staleTime: 60_000,
  });
  // `canaisIndisponivel` só serve para decidir o dado (`undefined` em vez do Map) — loading e
  // erro tratam a UI (mensagem, aviso) de forma diferente, ver BarraFiltrosEstoque.
  const canaisIndisponivel = canaisLoading || canaisErro;

  // Filtro selecionado + canais caíram = a tela responderia errado. Volta para "todos".
  // Loading é transitório (sem aviso); erro precisa avisar, porque o filtro saiu por falha.
  useEffect(() => {
    if (canaisIndisponivel && filtro === 'nao-publicado') {
      setFiltro('todos');
      if (canaisErro) {
        toast.error('Filtro "Não publicado" desativado: falha ao carregar os canais.');
      }
    }
  }, [canaisIndisponivel, canaisErro, filtro]);

  // Esconder o menu NÃO protege a rota — URL direta renderiza a tela. A escrita já está
  // protegida pelas edges (403); isto é coerência de navegação.
  if (modulosLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!modulos?.includes('estoque')) return <Navigate to="/" replace />;

  const lista = filtrarProdutos(produtos ?? [], {
    termo: busca, filtro, ordem,
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
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
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
          <BarraFiltrosEstoque
            termo={busca} filtro={filtro} ordem={ordem}
            canaisCarregando={canaisLoading} canaisErro={canaisErro}
            onTermo={setBusca} onFiltro={setFiltro} onOrdem={setOrdem}
          />
          <div className="flex flex-col gap-2">
            {lista.map((p) => (
              <ProdutoCard
                key={p.codigoPai}
                produto={p}
                canais={canaisPorProduto?.get(p.codigoPai) ?? []}
                onDarEntrada={(alvo) => { setAlvoEntrada(alvo); setEntradaAberta(true); }}
              />
            ))}
            {lista.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                {busca.trim() !== ''
                  ? `Nenhum produto bate com “${busca}”.`
                  : 'Nenhum produto encontrado com o filtro selecionado.'}
              </p>
            )}
          </div>
        </>
      )}

      <DialogEntrada
        produtos={produtos ?? []}
        aberto={entradaAberta}
        onFechar={() => setEntradaAberta(false)}
        skuInicial={alvoEntrada?.sku}
        filtroInicial={alvoEntrada?.codigoPai}
      />
      <DialogCadastroProduto
        aberto={cadastroAberto}
        onFechar={() => setCadastroAberto(false)}
      />
    </div>
  );
}
