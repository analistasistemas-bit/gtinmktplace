// ADR-0201: botão "Galeria IA" da linha de Publicados (com texto, proposta 3.1). Sem o módulo `imagem_ia` não existe.
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
      className="h-7 gap-1 px-2 text-xs"
      onClick={(e) => {
        e.stopPropagation();
        guardarRetorno(search);
        navigate(`/publicados/${encodeURIComponent(mlItemId)}/galeria`);
      }}
    >
      <Images className="h-3 w-3" />Galeria IA
    </Button>
  );
}
