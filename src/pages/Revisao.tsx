import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FamiliaRow } from '@/components/familia-row';
import { FamiliaExpanded } from '@/components/familia-expanded';
import { useFamilias } from '@/hooks/useFamilias';
import type { Familia } from '@/lib/mocks/types';

type FiltroOp = 'todos' | 'CREATE' | 'UPDATE' | 'avisos';

export function filtrarFamilias(familias: Familia[], filtro: FiltroOp, busca: string): Familia[] {
  const buscaLower = busca.trim().toLowerCase();
  return familias.filter((f) => {
    if (filtro === 'CREATE' && f.operacao !== 'CREATE') return false;
    if (filtro === 'UPDATE' && f.operacao !== 'UPDATE') return false;
    if (filtro === 'avisos' && !f.precoAbaixo20pc) return false;
    if (buscaLower && !f.titulo.toLowerCase().includes(buscaLower) && !f.codigoPai.includes(buscaLower))
      return false;
    return true;
  });
}

export default function Revisao() {
  const { loteId } = useParams();
  const familias = useFamilias(loteId);
  const [filtro, setFiltro] = useState<FiltroOp>('todos');
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  const visiveis = useMemo(() => filtrarFamilias(familias, filtro, busca), [familias, filtro, busca]);

  function toggleSelecao(id: string, valor: boolean) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (valor) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }

  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const counts = {
    todos: familias.length,
    CREATE: familias.filter((f) => f.operacao === 'CREATE').length,
    UPDATE: familias.filter((f) => f.operacao === 'UPDATE').length,
    avisos: familias.filter((f) => f.precoAbaixo20pc).length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-background p-3 text-sm">
        <Input
          placeholder="Buscar por código ou nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
        />
        {(['todos', 'CREATE', 'UPDATE', 'avisos'] as FiltroOp[]).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={
              filtro === f
                ? 'rounded-md bg-accent px-3 py-1 font-medium'
                : 'rounded-md px-3 py-1 text-muted-foreground hover:bg-accent/50'
            }
          >
            {f === 'todos'
              ? `Todos (${counts.todos})`
              : f === 'avisos'
              ? `⚠ Avisos (${counts.avisos})`
              : `${f} (${counts[f]})`}
          </button>
        ))}
      </div>
      {filtro === 'avisos' && (
        <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          Famílias com preço sugerido <strong>abaixo de 20%</strong> do preço da sua planilha.
          Reveja antes de aprovar para não vender no prejuízo.
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {visiveis.map((familia) => (
          <div key={familia.id}>
            <FamiliaRow
              familia={familia}
              selecionada={selecionadas.has(familia.id)}
              expandida={expandidas.has(familia.id)}
              onSelecionar={toggleSelecao}
              onExpandir={toggleExpansao}
            />
            {expandidas.has(familia.id) && <FamiliaExpanded familia={familia} />}
          </div>
        ))}
        {visiveis.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma família encontrada com esses filtros.
          </div>
        )}
      </div>
      {selecionadas.size > 0 && (
        <div className="flex items-center justify-between border-t bg-background px-4 py-3">
          <div className="text-sm text-muted-foreground">
            {selecionadas.size} selecionada(s) de {visiveis.length}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelecionadas(new Set())}>
              Rejeitar
            </Button>
            <Button onClick={() => setSelecionadas(new Set())}>
              Aprovar selecionada{selecionadas.size > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
