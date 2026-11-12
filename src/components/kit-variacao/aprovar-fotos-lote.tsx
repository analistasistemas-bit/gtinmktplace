// ADR-0200, adendo 11/11: "Aprovar todas" das fotos geradas por IA. A trava humana do Adendo 1 continua: cada foto em
// tamanho real ao lado das originais da peça, e só "Confirmar K fotos" (com todas as fotos carregadas) aprova.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusPill } from '@/components/ui/status-pill';
import type { CandidataFoto } from './foto-combinacao';

export function AprovarFotosLote({ itens, onConfirmar, onFechar }: {
  itens: Array<{ rotulo: string; candidata: CandidataFoto }>;
  onConfirmar: () => void;
  onFechar: () => void;
}) {
  const [carregadas, setCarregadas] = useState<Set<string>>(new Set());
  const k = itens.length;
  const todas = itens.every((i) => carregadas.has(i.rotulo));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="flex max-h-[92vh] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="border-b p-4 pr-12">
          <DialogTitle>Aprovar {k} {k === 1 ? 'foto' : 'fotos'}</DialogTitle>
          <DialogDescription>
            Compare cada foto com as originais da peça (comprimento, modelagem, cor e detalhes). Só as confirmadas aqui vão
            para o anúncio.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
          {itens.map(({ rotulo, candidata }) => (
            <li key={rotulo} className="grid gap-3 rounded-md border p-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{rotulo}</span>
                  {candidata.conferencia.itens.length > 0 && <StatusPill tone="success">Conferida com a peça original</StatusPill>}
                </div>
                {candidata.url
                  ? <img
                      src={candidata.url} alt={`Foto gerada ${rotulo}, tamanho real`}
                      onLoad={() => setCarregadas((s) => new Set(s).add(rotulo))}
                      className="mx-auto max-h-[60vh] w-auto max-w-full rounded-md bg-muted/40 object-contain"
                    />
                  : <p className="text-sm text-muted-foreground">A prévia não carregou. Feche e use "Recarregar prévia".</p>}
              </div>
              <div className="grid content-start gap-3">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Fotos originais</span>
                {candidata.conferencia.originais.map((o) => (
                  <div key={o.cor} className="grid gap-1.5">
                    <span className="text-sm">{o.cor}</span>
                    <div className="grid grid-cols-3 gap-2">
                      {o.urls.map((u, i) => (
                        <img key={u} src={u} alt={`Original ${o.cor} ${i + 1}`} className="aspect-square w-full rounded-md object-cover ring-1 ring-border" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter className="m-0 border-t p-4">
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button disabled={!todas} onClick={() => { onConfirmar(); onFechar(); }}>
            Confirmar {k} {k === 1 ? 'foto' : 'fotos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
