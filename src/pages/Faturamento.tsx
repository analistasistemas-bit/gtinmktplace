import { Receipt, RotateCcw, MessageCircleQuestion, MessagesSquare, MapPin } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AbaVendas } from '@/components/faturamento/aba-vendas';
import { AbaDevolucoes } from '@/components/faturamento/aba-devolucoes';
import { AbaPerguntas } from '@/components/faturamento/aba-perguntas';
import { AbaMensagens } from '@/components/faturamento/aba-mensagens';
import { AbaGeografia } from '@/components/faturamento/aba-geografia';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { useMensagensAguardando } from '@/hooks/useMensagens';

export default function Faturamento() {
  const { data: naoRespondidas } = usePerguntasNaoRespondidas();
  const mensagensAguardando = useMensagensAguardando();
  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Faturamento"
        subtitle="Vendas do Mercado Livre pedido a pedido, devoluções, perguntas e mensagens — num lugar só."
      />
      <Tabs defaultValue="vendas">
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
    </div>
  );
}
