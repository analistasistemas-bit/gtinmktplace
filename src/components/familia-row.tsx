import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Familia } from '@/lib/mocks/types';

interface FamiliaRowProps {
  familia: Familia;
  selecionada: boolean;
  expandida: boolean;
  onSelecionar: (id: string, valor: boolean) => void;
  onExpandir: (id: string) => void;
}

function formatarBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FamiliaRow({ familia, selecionada, expandida, onSelecionar, onExpandir }: FamiliaRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-[24px_40px_1fr_80px_140px_40px] items-center gap-3 border-b px-4 py-2 text-sm',
        familia.editadoPeloOperador && 'border-l-2 border-l-purple-500'
      )}
    >
      <Checkbox
        checked={selecionada}
        onCheckedChange={(v) => onSelecionar(familia.id, v === true)}
      />
      <div
        className="h-8 w-8 rounded bg-muted"
        style={
          familia.variacoes[0]
            ? { backgroundColor: familia.variacoes[0].corHex }
            : undefined
        }
      />
      <div>
        <div className="font-medium">{familia.titulo}</div>
        <div className="text-xs text-muted-foreground">
          PAI {familia.codigoPai} · {familia.variacoes.length} cores
        </div>
      </div>
      <Badge variant={familia.operacao === 'CREATE' ? 'default' : 'secondary'}>
        {familia.operacao}
      </Badge>
      <div className="flex items-center gap-1">
        <span>
          R$ {formatarBRL(familia.precoMin)}
          {familia.precoMin !== familia.precoMax && `-${formatarBRL(familia.precoMax)}`}
        </span>
        {familia.precoAbaixo20pc && (
          <AlertTriangle
            className="h-4 w-4 text-destructive"
            aria-label="Preço abaixo de 20% do seu preço"
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => onExpandir(familia.id)}
        className="text-muted-foreground hover:text-foreground"
        aria-label={expandida ? 'Recolher' : 'Expandir'}
      >
        {expandida ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
    </div>
  );
}
