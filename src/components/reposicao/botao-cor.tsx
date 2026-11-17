// Nome da cor na grade da Reposição: miniatura + clique abre a foto grande (para mandar ao fornecedor
// que não sabe quais são as estampas). Só a foto do próprio SKU: a capa da família repetiria a mesma
// imagem em toda linha, pior que nada.
import { useMemo } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useFotosProduto } from '@/hooks/useFotosProduto';
import { useImageUrl } from '@/hooks/useImageUrl';
import { normGtin } from '@/lib/gtin';

const rotulo = (c: string) => c || 'Sem cor';

/** Foto do primeiro tamanho da cor que tiver imagem própria (null se nenhum). */
function useFotoCor(codigos: string[]): string | null {
  const { data: fotos } = useFotosProduto();
  const path = useMemo(() => {
    for (const c of codigos) {
      const p = fotos?.porCodigo.get(normGtin(c));
      if (p) return p;
    }
    return null;
  }, [fotos, codigos]);
  const { data: url } = useImageUrl(path);
  return url ?? null;
}

export function BotaoCor({ cor, corHex, codigos }: { cor: string; corHex: string | null; codigos: string[] }) {
  const url = useFotoCor(codigos);
  const nome = rotulo(cor);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Ver detalhes da cor ${nome}`}
          className="-mx-1 flex min-h-11 items-center gap-2 rounded-md px-1 text-left font-medium hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
        >
          {url
            ? <img src={url} alt="" className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-foreground/20" />
            : corHex && <span aria-hidden className="h-3 w-3 shrink-0 rounded-full ring-1 ring-foreground/20" style={{ backgroundColor: corHex }} />}
          {nome}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{nome}</DialogTitle>
          <DialogDescription>Foto cadastrada para esta cor.</DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="flex flex-col items-center gap-3">
            <img src={url} alt={`Foto da cor ${nome}`} className="max-h-[70vh] w-full rounded-lg object-contain" />
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
              <ExternalLink className="h-4 w-4" aria-hidden />Abrir original
            </a>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="h-4 w-4" aria-hidden />Sem foto cadastrada para esta cor.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
