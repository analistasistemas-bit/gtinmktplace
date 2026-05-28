import { Image as ImageIcon } from 'lucide-react';

interface Props {
  capaUrl: string | null;
  tamanho: 'small' | 'large';
}

export function FotoCapaFamilia({ capaUrl, tamanho }: Props) {
  const classe = tamanho === 'small' ? 'h-10 w-10' : 'h-48 w-48';
  if (!capaUrl) {
    return (
      <div
        data-testid="capa-placeholder"
        className={`${classe} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
      >
        <ImageIcon className={tamanho === 'small' ? 'h-4 w-4' : 'h-8 w-8'} />
      </div>
    );
  }
  return (
    <img
      src={capaUrl}
      alt="Capa da família"
      className={`${classe} shrink-0 rounded-md object-cover`}
    />
  );
}
