import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ViabilidadeLinha } from '@/components/viabilidade-linha';
import { useAnaliseViabilidade } from '@/hooks/useAnaliseViabilidade';
import type { ItemAnalisado } from '@/lib/viabilidade';

const COLS = ['Produto', 'Menor ML', 'Vendedores', 'Seu mínimo', 'Líquido se igualar', 'Viabilidade'];

function Tabela({ itens, editavel }: { itens: ItemAnalisado[]; editavel: boolean }) {
  if (itens.length === 0) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-muted-foreground">
          {COLS.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {itens.map((it) => <ViabilidadeLinha key={it.gtin} item={it} editavel={editavel} />)}
      </tbody>
    </table>
  );
}

export default function Viabilidade() {
  const analise = useAnaliseViabilidade();
  const [gtins, setGtins] = useState('');

  const onDrop = (files: File[]) => { if (files[0]) analise.mutate({ tipo: 'planilha', file: files[0] }); };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false,
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
  });

  const itens = analise.data?.itens ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Análise de viabilidade"
        subtitle="Veja, antes de subir um lote, se os produtos já vendem no ML e se o preço é viável." />

      <Tabs defaultValue="planilha">
        <TabsList>
          <TabsTrigger value="planilha">Subir planilha</TabsTrigger>
          <TabsTrigger value="gtins">Colar GTINs</TabsTrigger>
        </TabsList>

        <TabsContent value="planilha">
          <div {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-sm text-muted-foreground ${isDragActive ? 'border-primary bg-accent/40' : 'border-border'}`}>
            <input {...getInputProps()} />
            <Upload className="mb-2 h-6 w-6" />
            Arraste o .xlsx (planilha completa do lote ou só NOME, UNIDADE, GTIN, PRECO, CUSTO)
          </div>
        </TabsContent>

        <TabsContent value="gtins">
          <div className="space-y-2">
            <textarea value={gtins} onChange={(e) => setGtins(e.target.value)} rows={5}
              placeholder="Um GTIN por linha" className="w-full rounded-md border border-border bg-background p-2 text-sm" />
            <button onClick={() => analise.mutate({ tipo: 'gtins', gtins: gtins.split('\n') })}
              disabled={analise.isPending || gtins.trim() === ''}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
              <Search className="h-4 w-4" /> Pesquisar
            </button>
          </div>
        </TabsContent>
      </Tabs>

      {analise.isPending && (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      )}
      {analise.isError && <p className="text-sm text-destructive">{analise.error.message}</p>}
      {analise.isSuccess && itens.length === 0 && (
        <EmptyState title="Nada para mostrar" description="Nenhum produto válido foi encontrado na entrada." />
      )}
      {itens.length > 0 && (
        <div className="rounded-lg border border-border">
          {analise.data!.ignorados > 0 && (
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              {analise.data!.ignorados} linha(s) ignorada(s) (sem GTIN/preço/custo).
            </p>
          )}
          <Tabela itens={itens} editavel={analise.variables?.tipo === 'gtins'} />
        </div>
      )}
    </div>
  );
}
