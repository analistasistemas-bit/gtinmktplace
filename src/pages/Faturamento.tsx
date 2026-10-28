import { Boxes, Receipt, LifeBuoy, MessageCircleQuestion, MapPin, PackageOpen } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { infoCanal } from '@/lib/canais';
import { AbaVendas } from '@/components/faturamento/aba-vendas';
import { AbaVendasSku } from '@/components/faturamento/aba-vendas-sku';
import { AbaPerguntas } from '@/components/faturamento/aba-perguntas';
import { AbaPosvenda, SUB_ABAS, type SubAba } from '@/components/faturamento/posvenda/aba-posvenda';
import { AbaGeografia } from '@/components/faturamento/aba-geografia';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { usePosvendaBadge } from '@/hooks/usePosvenda';

const ABAS = ['vendas', 'sku', 'posvenda', 'perguntas', 'geografia'] as const;
type Aba = (typeof ABAS)[number];

export default function Faturamento() {
  const { count: naoRespondidas } = usePerguntasNaoRespondidas();
  const badgePosvenda = usePosvendaBadge();
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();
  // Pós-venda/Perguntas/Geografia são dados do ML; outro canal → vazio acionável.
  const canalSemDados = canalAtivo !== 'todos' && canalAtivo !== 'mercado_livre';

  // Aba ativa vive na URL (?aba=devolucoes) para permitir deep-link direto (ex.: a partir do
  // "Precisa de atenção" do Dashboard ou do sino de notificações), em vez de sempre cair em Vendas.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaParam = searchParams.get('aba');
  // Links antigos (?aba=devolucoes / ?aba=mensagens: Dashboard, cockpit, sino) caem no Pós-venda.
  const legado = abaParam === 'devolucoes' || abaParam === 'mensagens' ? abaParam : null;
  const aba: Aba = legado ? 'posvenda' : (ABAS as readonly string[]).includes(abaParam ?? '') ? (abaParam as Aba) : 'vendas';
  const subParam = legado ?? searchParams.get('sub');
  const sub: SubAba = (SUB_ABAS as readonly string[]).includes(subParam ?? '') ? (subParam as SubAba) : 'reclamacoes';
  const setAba = (v: string) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    p.delete('sub');
    if (v === 'vendas') p.delete('aba'); else p.set('aba', v);
    return p;
  }, { replace: true });
  const setSub = (v: SubAba) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    p.set('aba', 'posvenda'); p.set('sub', v);
    return p;
  }, { replace: true });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Faturamento"
        subtitle="Vendas pedido a pedido, pós-venda, perguntas — num lugar só."
      />
      <CanalTabs canal={canalAtivo} onCanal={setCanal} habilitados={habilitados} className="mb-4" />
      {canalSemDados ? (
        <EmptyState
          icon={PackageOpen}
          title={`Ainda sem vendas no ${infoCanal(canalAtivo)?.nome ?? canalAtivo}`}
          description="Assim que este canal tiver pedidos, eles aparecem aqui."
          action={<Button asChild variant="outline"><Link to="/configuracoes/canais">Ver canais</Link></Button>}
        />
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="vendas"><Receipt className="h-4 w-4" />Vendas</TabsTrigger>
            <TabsTrigger value="sku"><Boxes className="h-4 w-4" />Vendas SKU</TabsTrigger>
            <TabsTrigger value="posvenda">
              <LifeBuoy className="h-4 w-4" />Pós-venda
              {badgePosvenda > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {badgePosvenda}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="perguntas">
              <MessageCircleQuestion className="h-4 w-4" />Perguntas
              {naoRespondidas > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {naoRespondidas}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="geografia"><MapPin className="h-4 w-4" />Geografia</TabsTrigger>
          </TabsList>
          <TabsContent value="vendas" className="mt-4"><AbaVendas /></TabsContent>
          <TabsContent value="sku" className="mt-4"><AbaVendasSku /></TabsContent>
          <TabsContent value="posvenda" className="mt-4"><AbaPosvenda sub={sub} onSub={setSub} /></TabsContent>
          <TabsContent value="perguntas" className="mt-4"><AbaPerguntas /></TabsContent>
          <TabsContent value="geografia" className="mt-4"><AbaGeografia /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
