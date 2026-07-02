import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarFaltantesAtributos } from '@/lib/queries';
import { useSalvarAtributo } from '@/hooks/useFamiliaMutations';
import { StatusInline, type SaveStatus } from '@/components/status-inline';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CampoFaltante } from '@/lib/tipos-dominio';

const FLASH_MS = 2000;

// Camada 2B (ADR-0052): fallback quando a IA não preencheu um obrigatório. Busca os faltantes
// COM schema (tipo/valores) e salva inline, com feedback (StatusInline) igual título/descrição.
export function EditorAtributosFaltantes({ familiaId, loteId }: { familiaId: string; loteId: string }) {
  const { data: campos = [], isError } = useQuery({
    queryKey: ['faltantes-atributos', familiaId],
    queryFn: () => listarFaltantesAtributos(familiaId),
  });
  const salvar = useSalvarAtributo(loteId);
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});

  const setCampo = (id: string, s: SaveStatus) => setStatus((p) => ({ ...p, [id]: s }));
  const onSalvar = async (id: string, valor: string) => {
    if (!valor.trim()) return;
    setCampo(id, 'salvando');
    try {
      await salvar.mutateAsync({ familiaId, atributoId: id, valor });
      setCampo(id, 'salvo');
      setTimeout(() => setCampo(id, undefined), FLASH_MS);
    } catch {
      setCampo(id, 'erro');
    }
  };

  if (isError) {
    return (
      <p className="mt-2 border-t pt-2 text-xs text-destructive">
        Não foi possível carregar os campos. Recarregue a página para tentar de novo.
      </p>
    );
  }
  if (campos.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2">
      <p className="text-xs font-medium text-warning">Complete para publicar:</p>
      {campos.map((c: CampoFaltante) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">{c.nome}</label>
            <StatusInline status={status[c.id]} />
          </div>
          {c.tipo === 'closed' ? (
            <Select onValueChange={(v) => onSalvar(c.id, v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Escolher" /></SelectTrigger>
              <SelectContent>
                {c.valores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 text-xs"
              placeholder={c.tipo === 'numero' ? (c.unidades?.length ? `nº + ${c.unidades[0].nome}` : 'número') : 'texto'}
              onBlur={(e) => onSalvar(c.id, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
