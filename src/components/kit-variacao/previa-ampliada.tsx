// ADR-0200, Adendo 1: prévia ampliada da foto do kit gerada por IA. A gerada em tamanho real (com zoom) ao lado das
// fotos originais de cada cor e do resultado da conferência item a item. "Usar esta foto" só existe para a aprovada
// e só libera depois que a imagem carregou aqui; a reprovada só pode ser descartada ("Gerar de novo").
import { useState } from 'react';
import { Check, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusPill } from '@/components/ui/status-pill';
import type { ItemVerificado } from '@/lib/kit-variacao-edge';
import { cn } from '@/lib/utils';

export interface ConferenciaFoto {
  itens: ItemVerificado[];
  motivos: string[];
  originais: Array<{ cor: string; urls: string[] }>;
}

export function PreviaAmpliada({ open, onOpenChange, rotulo, url, aprovada, conferencia, onUsar, onGerarDeNovo, gerando }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rotulo: string;
  url: string | null;
  aprovada: boolean;
  conferencia: ConferenciaFoto;
  /** Só para a aprovada. */
  onUsar?: () => void;
  onGerarDeNovo: () => void;
  gerando: boolean;
}) {
  const [zoom, setZoom] = useState(false);
  const [carregada, setCarregada] = useState(false);
  const { itens, motivos, originais } = conferencia;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setZoom(false); }}>
      <DialogContent className="flex max-h-[92vh] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-4 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Foto do kit {rotulo}</DialogTitle>
            {aprovada
              ? <StatusPill tone="success">Aprovada na conferência</StatusPill>
              : <StatusPill tone="danger">Reprovada</StatusPill>}
          </div>
          <DialogDescription>
            {aprovada
              ? 'Compare com as fotos originais de cada cor antes de usar: comprimento, modelagem, cor e detalhes.'
              : 'A conferência achou diferenças em relação à peça original. Esta foto não pode ser usada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
          <div className="relative min-h-0 bg-muted/40">
            {url && (
              <Button
                size="sm" variant="outline" className="absolute top-3 right-3 z-10 bg-background/90"
                aria-pressed={zoom} onClick={() => setZoom((z) => !z)}
              >
                {zoom ? <ZoomOut className="size-3.5" /> : <ZoomIn className="size-3.5" />}
                {zoom ? 'Afastar' : 'Aproximar'}
              </Button>
            )}
            <div className="h-full max-h-[60vh] overflow-auto p-4 lg:max-h-none">
              {url
                ? <img
                    src={url} alt={`Foto gerada ${rotulo}, ampliada`}
                    onLoad={() => setCarregada(true)} onError={() => setCarregada(false)}
                    className={cn(
                      'mx-auto rounded-md',
                      zoom ? 'w-[200%] max-w-none' : 'max-h-[56vh] w-auto max-w-full object-contain lg:max-h-[70vh]',
                    )}
                  />
                : <p className="grid h-40 place-items-center text-sm text-muted-foreground">A prévia não carregou. Feche e use "Recarregar prévia".</p>}
            </div>
          </div>

          <aside className="grid content-start gap-5 border-t p-4 lg:overflow-y-auto lg:border-t-0 lg:border-l">
            <section className="grid gap-3" aria-label="Fotos originais">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fotos originais</h3>
              {originais.length === 0 && <p className="text-xs text-muted-foreground">As fotos originais não vieram nesta prévia.</p>}
              {originais.map((o) => (
                <div key={o.cor} className="grid gap-1.5">
                  <span className="text-sm font-medium">{o.cor}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {o.urls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                        <img src={u} alt={`Original ${o.cor} ${i + 1}`} className="aspect-square w-full rounded-md object-cover ring-1 ring-border" />
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <section className="grid gap-2" aria-label="Conferência item a item">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Conferência item a item</h3>
              {itens.length > 0 ? (
                <ul className="grid gap-1.5">
                  {itens.map((i) => (
                    <li key={i.campo} className="flex gap-2 text-sm">
                      {i.ok
                        ? <Check aria-label="Igual" className="mt-0.5 size-4 shrink-0 text-success" />
                        : <X aria-label="Diferente" className="mt-0.5 size-4 shrink-0 text-danger" />}
                      <span className="min-w-0">
                        <span className="font-medium">{i.rotulo}</span>
                        {!i.ok && <span className="block text-xs text-muted-foreground">{i.nota}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {motivos.map((m) => (
                    <li key={m} className="flex gap-2"><X aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />{m}</li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>

        <DialogFooter className="m-0 border-t p-4">
          <Button variant="outline" disabled={gerando} onClick={() => { onOpenChange(false); onGerarDeNovo(); }}>
            {gerando && <Loader2 className="size-3.5 animate-spin" />} Gerar de novo
          </Button>
          {aprovada && onUsar && (
            <Button disabled={!carregada} onClick={() => { onUsar(); onOpenChange(false); }}>Usar esta foto</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
