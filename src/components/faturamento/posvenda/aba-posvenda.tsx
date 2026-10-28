import { useMemo, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useFilaPosvenda, useTentativasAtivas } from '@/hooks/usePosvenda';
import { useResumoMensagens } from '@/hooks/useMensagens';
import { classificar, subAbaDe } from '@/lib/posvenda-fila';
import { AbaDevolucoes } from '@/components/faturamento/aba-devolucoes';
import { AbaMensagens } from '@/components/faturamento/aba-mensagens';
import { ListaReclamacoes } from './lista-reclamacoes';
import { ListaDevolucoes } from './lista-devolucoes';

export const SUB_ABAS = ['reclamacoes', 'devolucoes', 'mensagens'] as const;
export type SubAba = (typeof SUB_ABAS)[number];

function Badge({ n }: { n: number }) {
  return n > 0 ? (
    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">{n}</span>
  ) : null;
}

export function AbaPosvenda({ sub, onSub }: { sub: SubAba; onSub: (s: SubAba) => void }) {
  const fila = useFilaPosvenda();
  const travasQ = useTentativasAtivas();
  // Sem conhecer as travas não dá para liberar ação nenhuma: carregando/erro => null (tudo indisponível).
  // Releitura com erro => desconhecidas, mesmo que o cache ainda tenha dados antigos.
  const travas = travasQ.isError ? null : travasQ.data ?? null;
  const naoLidas = useResumoMensagens().data?.naoLidas.total ?? 0;
  const [historico, setHistorico] = useState(false);

  const { reclamacoes, devolucoes } = useMemo(() => {
    const r = { reclamacoes: [] as NonNullable<typeof fila.data>, devolucoes: [] as NonNullable<typeof fila.data> };
    for (const d of fila.data ?? []) r[subAbaDe(d)].push(d);
    return r;
  }, [fila.data]);
  const urgentes = (l: typeof reclamacoes) => l.filter((d) => classificar(d) === 'urgente').length;

  const avisoTravas = travasQ.isError ? (
    <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
      Não foi possível conferir as ações em andamento; as ações ficam indisponíveis até conferirmos.
      <Button size="sm" variant="outline" onClick={() => void travasQ.refetch()}>Tentar de novo</Button>
    </div>
  ) : travasQ.isPending ? (
    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Conferindo ações em andamento…</div>
  ) : null;
  const erroFila = fila.isError ? <p className="text-sm text-destructive">Não foi possível carregar a fila: {(fila.error as Error).message}</p> : null;

  return (
    <Tabs value={sub} onValueChange={(v) => onSub(v as SubAba)}>
      <TabsList>
        <TabsTrigger value="reclamacoes">Reclamações<Badge n={urgentes(reclamacoes)} /></TabsTrigger>
        <TabsTrigger value="devolucoes">Devoluções<Badge n={urgentes(devolucoes)} /></TabsTrigger>
        <TabsTrigger value="mensagens">Mensagens<Badge n={naoLidas} /></TabsTrigger>
      </TabsList>
      <TabsContent value="reclamacoes" className="mt-4">
        {avisoTravas}
        {erroFila ?? <ListaReclamacoes itens={reclamacoes} travas={travas} />}
      </TabsContent>
      <TabsContent value="devolucoes" className="mt-4">
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setHistorico((h) => !h)}>
            {historico ? 'Voltar à fila' : <><History className="h-4 w-4" />Histórico</>}
          </Button>
        </div>
        {historico ? <AbaDevolucoes /> : (
          <>
            {avisoTravas}
            {erroFila ?? <ListaDevolucoes itens={devolucoes} travas={travas} />}
          </>
        )}
      </TabsContent>
      <TabsContent value="mensagens" className="mt-4"><AbaMensagens /></TabsContent>
    </Tabs>
  );
}
