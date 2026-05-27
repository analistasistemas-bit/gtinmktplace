import { Input } from '@/components/ui/input';
import type { Variacao } from '@/lib/tipos-dominio';

interface VariacaoCardProps {
  variacao: Variacao;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
}

export function VariacaoCard({ variacao, onMudarPreco, onMudarCor }: VariacaoCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-background p-2 text-sm">
      <div
        className="h-6 w-6 shrink-0 rounded"
        style={{ backgroundColor: variacao.corHex }}
        aria-label={`Cor ${variacao.cor}`}
      />
      <Input
        value={variacao.cor}
        onChange={(e) => onMudarCor(variacao.codigo, e.target.value)}
        className="h-7 flex-1"
      />
      <Input
        type="number"
        step="0.01"
        value={variacao.preco}
        onChange={(e) => onMudarPreco(variacao.codigo, parseFloat(e.target.value) || 0)}
        className="h-7 w-24"
      />
      <span className="w-16 text-right text-xs text-muted-foreground">
        estq {variacao.estoque}
      </span>
    </div>
  );
}
