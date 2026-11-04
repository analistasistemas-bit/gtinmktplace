// ADR-0194: aba Sugestões: produtos que vendem pouco, com campanha para aderir. Duas faixas, por vendas e visitas.
import { useId, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePaginacao } from '@/hooks/usePaginacao';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { useDispensarSugestao, useReativarSugestao, useSugestoesPromocao } from '@/hooks/useSugestoesPromocao';
import { ehTipoOperavel, rotuloTipo } from '@/lib/promocoes';
import type { OpcaoCampanha, Sugestao } from '@/lib/sugestoes-promocao';
import { CardSugestao } from './card-sugestao';
import { PreviewOperacao } from './preview-operacao';

const TAMANHOS = [20, 50, 100];

function Secao({ titulo, descricao, itens, renderItem }: {
  titulo: string; descricao: string; itens: Sugestao[]; renderItem: (s: Sugestao) => React.ReactNode;
}) {
  const id = useId();
  const pag = usePaginacao(itens, { tamanhoInicial: TAMANHOS[0] });
  const topo = useRef<HTMLElement>(null);
  const irPara = (n: number) => {
    pag.irPara(n);
    topo.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return (
    <section ref={topo} aria-labelledby={id} className="scroll-mt-6 rounded-xl border bg-card shadow-xs">
      <header className="border-b p-4">
        <h3 id={id} className="flex items-baseline gap-2 font-semibold">
          {titulo}
          <span className="text-sm font-normal tabular-nums text-muted-foreground">{itens.length.toLocaleString('pt-BR')}</span>
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>
      </header>
      <ul className="divide-y">{pag.itensPagina.map(renderItem)}</ul>
      {pag.total > TAMANHOS[0] && (
        <Pagination className="border-t px-4" rotuloItem="sugestão" tamanhos={TAMANHOS} paginaAtual={pag.paginaAtual}
          totalPaginas={pag.totalPaginas} inicio={pag.inicio} fim={pag.fim} total={pag.total} tamanho={pag.tamanho}
          onIrPara={irPara} onTamanho={pag.setTamanho} />
      )}
    </section>
  );
}

export function ListaSugestoes() {
  const { data, isLoading, isError, refetch } = useSugestoesPromocao();
  const podeExecutar = usePodeExecutarOperacao();
  const dispensar = useDispensarSugestao();
  const reativar = useReativarSugestao();
  const [visao, setVisao] = useState<'sugestoes' | 'dispensados'>('sugestoes');
  const [aderindo, setAderindo] = useState<{ s: Sugestao; opcao: OpcaoCampanha } | null>(null);

  if (isError) {
    return (
      <EmptyState icon={Lightbulb} title="Não foi possível carregar as sugestões." description="Os dados de vendas ou de campanhas não responderam."
        action={<Button variant="outline" onClick={refetch}>Tentar novamente</Button>} className="mt-4" />
    );
  }
  if (isLoading || !data) {
    return <div className="mt-4 flex flex-col gap-4">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>;
  }

  async function mudar(acao: () => Promise<unknown>, sucesso: string) {
    try {
      await acao();
      toast.success(sucesso);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar agora.');
    }
  }
  const comConversao = data.visitasPorUnidade != null;
  const ocupado = dispensar.isPending || reativar.isPending;
  const verDispensados = visao === 'dispensados' && data.dispensadas.length > 0;
  const card = (s: Sugestao, dispensada = false) => (
    <CardSugestao key={s.chave} s={s} podeExecutar={podeExecutar} comConversao={comConversao} dispensada={dispensada} ocupado={ocupado}
      onAderir={(opcao) => setAderindo({ s, opcao })}
      onDispensar={() => void mudar(() => dispensar.mutateAsync(s.chave), 'Sugestão dispensada por 30 dias.')}
      onReativar={() => void mudar(() => reativar.mutateAsync(s.chave), 'Sugestão reativada.')} />
  );
  const vazio = data.quaseVendendo.length === 0 && data.invisivel.length === 0;

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {comConversao
            ? `Produtos com menos de 5 vendas em 30 dias e convite de campanha. Sua conta vende 1 unidade a cada ${data.visitasPorUnidade!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} visitas.`
            : 'Produtos com convite de campanha. A conta ainda não tem vendas em 30 dias, então não há conversão para comparar.'}
        </p>
        {data.dispensadas.length > 0 && (
          <Tabs value={verDispensados ? 'dispensados' : 'sugestoes'} onValueChange={(v) => setVisao(v as typeof visao)}>
            <TabsList>
              <TabsTrigger value="sugestoes">Sugestões</TabsTrigger>
              <TabsTrigger value="dispensados">Dispensados{' '}<span className="tabular-nums text-muted-foreground">{data.dispensadas.length}</span></TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {verDispensados ? (
        <Secao titulo="Dispensados" descricao="Voltam sozinhos depois de 30 dias, se ainda fizerem sentido." itens={data.dispensadas} renderItem={(s) => card(s, true)} />
      ) : vazio ? (
        <EmptyState icon={Lightbulb} title="Nenhuma sugestão agora."
          description="Produtos que vendem pouco e têm convite de campanha aparecem aqui. Quem já participa ou tem menos de 30 dias no ar fica de fora." />
      ) : (
        <>
          {data.quaseVendendo.length > 0 && (
            <Secao titulo="Quase vendendo" itens={data.quaseVendendo} renderItem={(s) => card(s)}
              descricao="Recebem visitas, mas vendem abaixo da média da conta. O preço pode ser a barreira. A comparação é uma estimativa, não uma previsão de venda." />
          )}
          {data.invisivel.length > 0 && (
            <Secao titulo="Invisível" itens={data.invisivel} renderItem={(s) => card(s)}
              descricao="Vendem pouco e quase ninguém vê. A campanha ajuda pela exposição, mas o problema pode ser outro: título, foto ou Ads." />
          )}
        </>
      )}

      {aderindo && (
        <PreviewOperacao acao="aderir" tipo={ehTipoOperavel(aderindo.opcao.promocao.tipo) ? aderindo.opcao.promocao.tipo : 'DEAL'}
          promocaoId={aderindo.opcao.promocao.promocao_id}
          promocaoNome={aderindo.opcao.promocao.nome ?? rotuloTipo(aderindo.opcao.promocao.tipo)}
          itens={aderindo.opcao.itens} aberto onClose={() => setAderindo(null)} onSucesso={() => setAderindo(null)}
          sugestao={{ faixa: aderindo.s.faixa, oportunidade: Math.round(aderindo.s.oportunidade * 100) / 100, chave: aderindo.s.chave }} />
      )}
    </div>
  );
}
