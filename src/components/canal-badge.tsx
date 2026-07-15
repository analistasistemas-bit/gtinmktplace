import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CANAIS, infoCanal, contrasteTexto, type CanalId } from '@/lib/canais';

/**
 * Monograma colorido do canal (placeholder de logo). Quando houver SVG oficial em
 * src/assets/canais/<id>.svg, trocar só aqui — a API não muda.
 */
export function LogoCanal({ canal, className }: { canal: CanalId; className?: string }) {
  const info = CANAIS[canal];
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none', className)}
      style={{ backgroundColor: info.corMarca, color: contrasteTexto(info.corMarca) }}
    >
      {info.monograma}
    </span>
  );
}

/** Chip logo+nome do canal — linhas de tabela, cards e selects. */
export function CanalBadge({ canal, className }: { canal: string; className?: string }) {
  const info = infoCanal(canal);
  if (!info) return <Badge variant="outline" className={className}>{canal}</Badge>;
  return (
    <Badge variant="outline" className={cn('gap-1 font-normal', className)}>
      <LogoCanal canal={info.id} className="h-3.5 w-3.5" />
      {info.nome}
    </Badge>
  );
}
