import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { amountComDesconto, validarFaixas, MAX_FAIXAS, type FaixaAtacado } from '@/lib/atacado';

interface Props {
  faixas: FaixaAtacado[];
  precoBase: number;
  onChange: (faixas: FaixaAtacado[]) => void;
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Editor controlado de até 5 faixas de atacado (min unidades + % off) com preview. */
export function AtacadoEditor({ faixas, precoBase, onChange }: Props) {
  const erro = validarFaixas(faixas);

  function set(i: number, campo: keyof FaixaAtacado, valor: number) {
    onChange(faixas.map((f, idx) => (idx === i ? { ...f, [campo]: valor } : f)));
  }
  function remover(i: number) {
    onChange(faixas.filter((_, idx) => idx !== i));
  }
  function adicionar() {
    const ultimo = faixas[faixas.length - 1];
    onChange([...faixas, {
      min_unidades: ultimo ? ultimo.min_unidades + 5 : 5,
      desconto_pct: ultimo ? Math.min(ultimo.desconto_pct + 2, 99) : 5,
    }]);
  }

  return (
    <div className="space-y-1.5">
      {faixas.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span>a partir de</span>
          <Input type="number" min={2} className="w-16"
            value={f.min_unidades}
            onChange={(e) => set(i, 'min_unidades', Math.trunc(Number(e.target.value)))} />
          <span>un ·</span>
          <Input type="number" min={1} max={99} className="w-14"
            value={f.desconto_pct}
            onChange={(e) => set(i, 'desconto_pct', Number(e.target.value))} />
          <span>% off</span>
          {precoBase > 0 && f.desconto_pct > 0 && f.desconto_pct < 100 && (
            <span className="text-muted-foreground">→ R$ {brl(amountComDesconto(precoBase, f.desconto_pct))}</span>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
            aria-label="Remover faixa" onClick={() => remover(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      {faixas.length < MAX_FAIXAS && (
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={adicionar}>
          <Plus className="mr-1 h-3 w-3" /> Adicionar faixa
        </Button>
      )}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
    </div>
  );
}
