import { Input } from '@/components/ui/input';
import { useImageUrl } from '@/hooks/useImageUrl';
import type { Variacao } from '@/lib/tipos-dominio';

interface VariacaoCardProps {
  variacao: Variacao;
  onMudarPreco: (codigo: string, novoPreco: number) => void;
  onMudarCor: (codigo: string, novaCor: string) => void;
  onSalvarPreco?: (codigo: string) => void;
}

export function VariacaoCard({ variacao, onMudarPreco, onMudarCor, onSalvarPreco }: VariacaoCardProps) {
  const { data: imgUrl } = useImageUrl(variacao.fotoPath);
  return (
    <div className="flex items-center gap-3 rounded-md bg-background p-2 text-sm">
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={variacao.cor || variacao.codigo}
          className="h-8 w-8 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="h-8 w-8 shrink-0 rounded border"
          style={{ backgroundColor: variacao.corHex }}
          aria-label={variacao.cor ? `Cor ${variacao.cor}` : 'Sem imagem'}
        />
      )}
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
        onBlur={() => onSalvarPreco?.(variacao.codigo)}
        className="h-7 w-24"
      />
      <div className="flex w-20 flex-col items-end leading-tight">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Estoque
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {new Intl.NumberFormat('pt-BR').format(variacao.estoque)}
        </span>
      </div>
    </div>
  );
}
