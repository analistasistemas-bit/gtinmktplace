import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useSalvarAtributo } from '@/hooks/useFamiliaMutations';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { StatusPill } from '@/components/ui/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Familia } from '@/lib/tipos-dominio';

const FLASH_MS = 2000;

// ADR-0202: atributos que a IA tirou da foto (ex.: Tipo de manga). Ficam visíveis e corrigíveis na
// Revisão; trocar salva pelo mesmo caminho do editor de faltantes (atributos-familia / salvar).
export function AtributosPorFoto({ familia }: { familia: Familia }) {
  // ponytail: early return fora do componente com hooks — só monta a mutação quando há o que mostrar.
  return familia.atributosPorFoto?.length ? <ListaPorFoto familia={familia} /> : null;
}

function ListaPorFoto({ familia }: { familia: Familia }) {
  const salvar = useSalvarAtributo(familia.loteId);
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const itens = familia.atributosPorFoto ?? [];

  const setCampo = (id: string, s: SaveStatus) => setStatus((p) => ({ ...p, [id]: s }));
  const onSalvar = async (id: string, valor: string) => {
    setCampo(id, 'salvando');
    try {
      await salvar.mutateAsync({ familiaId: familia.id, atributoId: id, valor });
      setCampo(id, 'salvo');
      setTimeout(() => setCampo(id, undefined), FLASH_MS);
    } catch {
      setCampo(id, 'erro');
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      <StatusPill tone="info" className="self-start">
        <Sparkles className="h-3 w-3" /> Pela foto (IA) — confira
      </StatusPill>
      {itens.map((a) => {
        const atual = familia.atributosMl.find((x) => x.id === a.id)?.value_id ?? undefined;
        return (
          <div key={a.id} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">{a.nome}</label>
              <StatusInline status={status[a.id]} />
            </div>
            <Select value={atual} onValueChange={(v) => onSalvar(a.id, v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
              <SelectContent>
                {a.valores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
