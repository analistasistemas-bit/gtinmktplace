// ADR-0201: botão "Galeria IA" da linha de Publicados. Sem o módulo `imagem_ia` não existe.
import { Images } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function BotaoGaleria({ temImagemIA, mlItemId, codigoPai, onAbrir }: {
  temImagemIA: boolean; mlItemId: string; codigoPai: string; onAbrir: (alvo: { mlItemId: string; codigoPai: string }) => void;
}) {
  if (!temImagemIA) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Galeria IA"
      title="Galeria IA"
      className="h-7 px-2 text-xs"
      onClick={(e) => { e.stopPropagation(); onAbrir({ mlItemId, codigoPai }); }}
    >
      <Images className="h-3 w-3" />
    </Button>
  );
}
