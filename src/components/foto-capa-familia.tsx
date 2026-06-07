import { Image as ImageIcon } from 'lucide-react';

interface Props {
  capaUrl: string | null;
  tamanho: 'small' | 'medium' | 'large';
}

const CLASSE_FOTO = { small: 'h-10 w-10', medium: 'h-20 w-20', large: 'h-48 w-48' } as const;
const CLASSE_ICONE = { small: 'h-4 w-4', medium: 'h-6 w-6', large: 'h-8 w-8' } as const;

export function FotoCapaFamilia({ capaUrl, tamanho }: Props) {
  const classe = CLASSE_FOTO[tamanho];
  if (!capaUrl) {
    return (
      <div
        data-testid="capa-placeholder"
        className={`${classe} flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground`}
      >
        <ImageIcon className={CLASSE_ICONE[tamanho]} />
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
