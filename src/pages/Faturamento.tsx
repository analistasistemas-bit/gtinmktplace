import { Receipt, RotateCcw, MessageCircleQuestion, MessagesSquare, MapPin, PackageOpen } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CanalTabs } from '@/components/canal-tabs';
import { useCanalAtivo } from '@/hooks/useCanalAtivo';
import { infoCanal } from '@/lib/canais';
import { AbaVendas } from '@/components/faturamento/aba-vendas';
import { AbaDevolucoes } from '@/components/faturamento/aba-devolucoes';
import { AbaPerguntas } from '@/components/faturamento/aba-perguntas';
import { AbaMensagens } from '@/components/faturamento/aba-mensagens';
import { AbaGeografia } from '@/components/faturamento/aba-geografia';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { useMensagensAguardando } from '@/hooks/useMensagens';

const ABAS = ['vendas', 'devolucoes', 'perguntas', 'mensagens', 'geografia'] as const;
type Aba = (typeof ABAS)[number];

export default function Faturamento() {
  const { data: naoRespondidas } = usePerguntasNaoRespondidas();
  const mensagensAguardando = useMensagensAguardando();
  const { canal: canalAtivo, setCanal, habilitados } = useCanalAtivo();
  // Devoluções/Perguntas/Mensagens/Geografia são dados do ML; outro canal → vazio acionável.
  const canalSemDados = canalAtivo !== 'todos' && canalAtivo !== 'mercado_livre';

  // Aba ativa vive na URL (?aba=devolucoes) para permitir deep-link direto (ex.: a partir do
  // "Precisa de atenção" do Dashboard ou do sino de notificações), em vez de sempre cair em Vendas.
  const [searchParams, setSearchParams] = useSearchParams();
  const abaParam = searchParams.get('aba');
  const aba: Aba = (ABAS as readonly string[]).includes(abaParam ?? '') ? (abaParam as Aba) : 'vendas';
  const setAba = (v: string) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    if (v === 'vendas') p.delete('aba'); else p.set('aba', v);
    return p;
  }, { replace: true });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Faturamento"
        subtitle="Vendas pedido a pedido, devoluções, perguntas e mensagens — num lugar só."
      />
      <CanalTabs canal={canalAtivo} onCanal={setCanal} habilitados={habilitados} className="mb-4" />
      {canalSemDados ? (
        <EmptyState
          icon={PackageOpen}
          title={`Ainda sem vendas no ${infoCanal(canalAtivo)?.nome ?? canalAtivo}`}
          description="Assim que este canal tiver pedidos, eles aparecem aqui."
          action={<Button asChild variant="outline"><Link to="/canais">Ver canais</Link></Button>}
        />
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="vendas"><Receipt className="h-4 w-4" />Vendas</TabsTrigger>
            <TabsTrigger value="devolucoes"><RotateCcw className="h-4 w-4" />Devoluções</TabsTrigger>
            <TabsTrigger value="perguntas">
              <MessageCircleQuestion className="h-4 w-4" />Perguntas
              {naoRespondidas != null && naoRespondidas > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {naoRespondidas}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="mensagens">
              <MessagesSquare className="h-4 w-4" />Mensagens
              {mensagensAguardando > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {mensagensAguardando}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="geografia"><MapPin className="h-4 w-4" />Geografia</TabsTrigger>
          </TabsList>
          <TabsContent value="vendas" className="mt-4"><AbaVendas /></TabsContent>
          <TabsContent value="devolucoes" className="mt-4"><AbaDevolucoes /></TabsContent>
          <TabsContent value="perguntas" className="mt-4"><AbaPerguntas /></TabsContent>
          <TabsContent value="mensagens" className="mt-4"><AbaMensagens /></TabsContent>
          <TabsContent value="geografia" className="mt-4"><AbaGeografia /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
