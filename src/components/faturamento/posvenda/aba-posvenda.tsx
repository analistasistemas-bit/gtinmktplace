import { useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useFilaPosvenda, useTentativasAtivas } from '@/hooks/usePosvenda';
import { useResumoMensagens } from '@/hooks/useMensagens';
import { classificar, subAbaDe } from '@/lib/posvenda-fila';
import { AbaDevolucoes } from '@/components/faturamento/aba-devolucoes';
import { AbaMensagens } from '@/components/faturamento/aba-mensagens';
import { ListaReclamacoes } from './lista-reclamacoes';
import { ListaDevolucoes } from './lista-devolucoes';

export const SUB_ABAS = ['reclamacoes', 'devolucoes', 'mensagens', 'historico'] as const;
export type SubAba = (typeof SUB_ABAS)[number];

function Badge({ n }: { n: number }) {
  return n > 0 ? (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{n}</span>
  ) : null;
}

export function AbaPosvenda({ sub, onSub }: { sub: SubAba; onSub: (s: SubAba) => void }) {
  const fila = useFilaPosvenda();
  const ativas = useTentativasAtivas().data ?? [];
  const naoLidas = useResumoMensagens().data?.naoLidas.total ?? 0;

  const { reclamacoes, devolucoes } = useMemo(() => {
    const r = { reclamacoes: [] as NonNullable<typeof fila.data>, devolucoes: [] as NonNullable<typeof fila.data> };
    for (const d of fila.data ?? []) r[subAbaDe(d)].push(d);
    return r;
  }, [fila.data]);
  const urgentes = (l: typeof reclamacoes) => l.filter((d) => classificar(d) === 'urgente').length;

  return (
    <Tabs value={sub} onValueChange={(v) => onSub(v as SubAba)}>
      <TabsList>
        <TabsTrigger value="reclamacoes">Reclamações<Badge n={urgentes(reclamacoes)} /></TabsTrigger>
        <TabsTrigger value="devolucoes">Devoluções<Badge n={urgentes(devolucoes)} /></TabsTrigger>
        <TabsTrigger value="mensagens">Mensagens<Badge n={naoLidas} /></TabsTrigger>
        <TabsTrigger value="historico">Histórico</TabsTrigger>
      </TabsList>
      <TabsContent value="reclamacoes" className="mt-4">
        {fila.isError ? <p className="text-sm text-destructive">Não foi possível carregar a fila: {(fila.error as Error).message}</p>
          : <ListaReclamacoes itens={reclamacoes} tentativas={ativas} />}
      </TabsContent>
      <TabsContent value="devolucoes" className="mt-4">
        {fila.isError ? <p className="text-sm text-destructive">Não foi possível carregar a fila: {(fila.error as Error).message}</p>
          : <ListaDevolucoes itens={devolucoes} tentativas={ativas} />}
      </TabsContent>
      <TabsContent value="mensagens" className="mt-4"><AbaMensagens /></TabsContent>
      <TabsContent value="historico" className="mt-4"><AbaDevolucoes /></TabsContent>
    </Tabs>
  );
}
