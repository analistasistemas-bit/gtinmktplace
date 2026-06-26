import { Package } from 'lucide-react';
import { useImageUrl } from '@/hooks/useImageUrl';

/** Item mínimo p/ a miniatura: foto (storage path) + título (alt/hover). */
export interface ItemThumb {
  id: string;
  titulo: string | null;
  imagem_path: string | null;
}

/** Miniatura quadrada da foto do produto (signed URL). Fallback: ícone de pacote. */
export function ThumbProduto({ path, titulo, size = 36 }: { path: string | null; titulo: string | null; size?: number }) {
  const { data: url } = useImageUrl(path);
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border bg-muted"
      style={{ width: size, height: size }}
      title={titulo ?? undefined}
    >
      {url
        ? <img src={url} alt={titulo ?? ''} loading="lazy" className="h-full w-full object-cover" />
        : <Package className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

/** Pilha de até 3 miniaturas dos produtos do pedido/venda + contador "+N". */
export function PilhaThumbs({ itens }: { itens: ItemThumb[] }) {
  const MAX = 3;
  const visiveis = itens.slice(0, MAX);
  const resto = itens.length - visiveis.length;
  return (
    <div className="flex items-center gap-1">
      {visiveis.map((it) => <ThumbProduto key={it.id} path={it.imagem_path} titulo={it.titulo} />)}
      {resto > 0 && <span className="text-xs font-medium tabular-nums text-muted-foreground">+{resto}</span>}
    </div>
  );
}
