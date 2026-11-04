// ADR-0194 (emenda 2026-11-04): marca as campanhas de preço enviado (DEAL) de um produto; cada uma é confirmada depois no PreviewOperacao.
import { useId, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusPill } from '@/components/ui/status-pill';
import { rotuloTipo } from '@/lib/promocoes';
import { periodosCoincidem, type OpcaoCampanha, type Sugestao } from '@/lib/sugestoes-promocao';
import { ResumoCampanha } from './card-sugestao';

const dia = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null);
const quando = (o: OpcaoCampanha) => (o.promocao.inicio ? Date.parse(o.promocao.inicio) : 0);

export function EscolherCampanhas({ s, opcoes, inicial, onContinuar, onClose }: {
  s: Sugestao; opcoes: OpcaoCampanha[]; inicial: OpcaoCampanha;
  onContinuar: (escolhidas: OpcaoCampanha[]) => void; onClose: () => void;
}) {
  const id = useId();
  const [marcadas, setMarcadas] = useState(() => new Set([inicial.promocao.promocao_id]));
  const ordenadas = [...opcoes].sort((a, b) => quando(a) - quando(b));
  const escolhidas = ordenadas.filter((o) => marcadas.has(o.promocao.promocao_id));

  function alternar(promocaoId: string) {
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (!nova.delete(promocaoId)) nova.add(promocaoId);
      return nova;
    });
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-full flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Em quais campanhas aderir?</SheetTitle>
          <SheetDescription>{s.titulo}. Você confere o preço e o que recebe em cada campanha no próximo passo.</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-1 flex-col divide-y divide-border overflow-y-auto px-4">
          {ordenadas.map((o) => {
            const campoId = `${id}-${o.promocao.promocao_id}`;
            const nome = o.promocao.nome ?? rotuloTipo(o.promocao.tipo);
            const [inicio, fim] = [dia(o.promocao.inicio), dia(o.promocao.fim)];
            return (
              <li key={o.promocao.promocao_id} className="flex items-start gap-3 py-3">
                <Checkbox id={campoId} checked={marcadas.has(o.promocao.promocao_id)} onCheckedChange={() => alternar(o.promocao.promocao_id)} className="mt-0.5" />
                <label htmlFor={campoId} className="min-w-0 flex-1">
                  <span className="block font-medium">{nome}</span>
                  {inicio && fim && <span className="block text-xs tabular-nums text-muted-foreground">{inicio} a {fim}</span>}
                  <span className="mt-1 block text-sm text-muted-foreground"><ResumoCampanha o={o} /></span>
                </label>
                {o.semaforo === 'amarelo' && <StatusPill tone="warning" className="shrink-0">Abaixo do piso</StatusPill>}
              </li>
            );
          })}
        </ul>
        <SheetFooter>
          {periodosCoincidem(escolhidas) && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>Estas campanhas podem valer nos mesmos dias. Quando isso acontece, o ML aplica o menor preço e o lucro mostrado na campanha mais cara pode não valer.</span>
            </p>
          )}
          <Button disabled={escolhidas.length === 0} onClick={() => onContinuar(escolhidas)}>Continuar ({escolhidas.length})</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
