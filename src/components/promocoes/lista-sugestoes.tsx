// ADR-0194: aba Sugestões: produtos que vendem pouco, com campanha para aderir. Duas faixas, por vendas e visitas.
import { useId, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { CarregandoMarca } from '@/components/ui/carregando-marca';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePaginacao } from '@/hooks/usePaginacao';
import { usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import { useDispensarSugestao, useReativarSugestao, useSugestoesPromocao } from '@/hooks/useSugestoesPromocao';
import { ehTipoOperavel, rotuloTipo } from '@/lib/promocoes';
import type { OpcaoCampanha, Sugestao } from '@/lib/sugestoes-promocao';
import { CardSugestao } from './card-sugestao';
import { EscolherCampanhas } from './escolher-campanhas';
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
  const [escolhendo, setEscolhendo] = useState<{ s: Sugestao; inicial: OpcaoCampanha; opcoes: OpcaoCampanha[] } | null>(null);
  const [fila, setFila] = useState<{ s: Sugestao; opcoes: OpcaoCampanha[]; i: number } | null>(null);

  if (isError) {
    return (
      <EmptyState icon={Lightbulb} title="Não foi possível carregar as sugestões." description="Os dados de vendas ou de campanhas não responderam."
        action={<Button variant="outline" onClick={refetch}>Tentar novamente</Button>} className="mt-4" />
    );
  }
  if (isLoading || !data) {
    return <CarregandoMarca className="mt-4" rotulo="Carregando" mensagem="Analisando vendas, visitas e campanhas…" />;
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
  // Várias de uma vez só em DEAL: preço enviado e sem reserva de estoque. SMART e Relâmpago seguem uma por vez.
  function aderir(s: Sugestao, opcao: OpcaoCampanha) {
    const deals = [s.recomendada, ...s.alternativas].filter((o) => o.promocao.tipo === 'DEAL');
    if (opcao.promocao.tipo === 'DEAL' && deals.length > 1) setEscolhendo({ s, inicial: opcao, opcoes: deals });
    else setFila({ s, opcoes: [opcao], i: 0 });
  }
  const card = (s: Sugestao, dispensada = false) => (
    <CardSugestao key={s.chave} s={s} podeExecutar={podeExecutar} comConversao={comConversao} dispensada={dispensada} ocupado={ocupado}
      onAderir={(opcao) => aderir(s, opcao)}
      onDispensar={() => void mudar(() => dispensar.mutateAsync(s.chave), 'Sugestão dispensada por 30 dias.')}
      onReativar={() => void mudar(() => reativar.mutateAsync(s.chave), 'Sugestão reativada.')} />
  );
  const vazio = data.quaseVendendo.length === 0 && data.invisivel.length === 0;
  const aderindo = fila?.opcoes[fila.i];

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

      {escolhendo && (
        <EscolherCampanhas s={escolhendo.s} opcoes={escolhendo.opcoes} inicial={escolhendo.inicial} onClose={() => setEscolhendo(null)}
          onContinuar={(opcoes) => { setEscolhendo(null); setFila({ s: escolhendo.s, opcoes, i: 0 }); }} />
      )}
      {fila && aderindo && (
        <PreviewOperacao acao="aderir" tipo={ehTipoOperavel(aderindo.promocao.tipo) ? aderindo.promocao.tipo : 'DEAL'}
          promocaoId={aderindo.promocao.promocao_id}
          promocaoNome={aderindo.promocao.nome ?? rotuloTipo(aderindo.promocao.tipo)}
          itens={aderindo.itens} aberto onClose={() => setFila(null)} onSucesso={() => setFila(null)}
          passo={fila.opcoes.length > 1 ? { atual: fila.i + 1, total: fila.opcoes.length } : undefined}
          aoConcluir={fila.i < fila.opcoes.length - 1 ? () => setFila((atual) => (atual === fila ? { ...fila, i: fila.i + 1 } : atual)) : undefined}
          sugestao={{ faixa: fila.s.faixa, oportunidade: Math.round(fila.s.oportunidade * 100) / 100, chave: fila.s.chave }} />
      )}
    </div>
  );
}
