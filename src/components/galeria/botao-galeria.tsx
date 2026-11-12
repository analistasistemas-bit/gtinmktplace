// ADR-0201: botão "Galeria IA" da linha de Publicados (só ícone; o nome aparece no hover via title, pois o texto estourava a coluna Ações). Sem o módulo `imagem_ia` não existe.
// Abre a página da galeria desta linha (identidade = `mlItemId`) guardando filtros e rolagem para a volta.
import { Images } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { guardarRetorno } from '@/lib/galeria/retorno';

export function BotaoGaleria({ temImagemIA, mlItemId }: { temImagemIA: boolean; mlItemId: string }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  if (!temImagemIA) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Galeria IA"
      title="Galeria IA"
      className="relative h-7 px-2 text-xs after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
      onClick={(e) => {
        e.stopPropagation();
        guardarRetorno(search);
        navigate(`/publicados/${encodeURIComponent(mlItemId)}/galeria`);
      }}
    >
      <Images aria-hidden className="h-3 w-3" />
    </Button>
  );
}
