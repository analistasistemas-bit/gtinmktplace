// Etapa 3: foto de cada SKU (miniatura) e visualizador ampliado com a quantidade editável ali mesmo.
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useImageUrl } from '@/hooks/useImageUrl';
import { urlFotoMl, type ProdutoEstoqueResumo, type VariacaoComSaldo } from '@/lib/produtos-saldo';

type Foto = Pick<VariacaoComSaldo, 'imagemPath' | 'mlPictureId'>;
export type CapaProduto = Pick<ProdutoEstoqueResumo, 'capaStoragePath' | 'capaMlPictureId'>;

/** Mesma cadeia da lista de Estoque (Storage → foto do ML), com a capa do produto como último recurso. */
function useFotoSku(v: Foto | undefined, produto: CapaProduto | null): string | null {
  const { data: propria } = useImageUrl(v?.imagemPath);
  const { data: capa } = useImageUrl(produto?.capaStoragePath);
  return propria ?? urlFotoMl(v?.mlPictureId) ?? capa ?? urlFotoMl(produto?.capaMlPictureId);
}

export const altFoto = (cor: string | null | undefined, tamanho: string | null | undefined) =>
  `Foto de ${[cor, tamanho].filter(Boolean).join(' ')}`.trim();

function Imagem({ url, alt, className, iconClass }: { url: string | null; alt: string; className: string; iconClass: string }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => { setFalhou(false); }, [url]);
  if (!url || falhou) {
    return (
      <div data-testid="foto-sku-placeholder" className={`${className} flex items-center justify-center bg-muted text-muted-foreground`}>
        <ImageIcon className={iconClass} />
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFalhou(true)} className={className} />;
}

export function MiniaturaSku({ v, produto, cor, tamanho, codigo, onAbrir, refBotao }: {
  v: Foto | undefined; produto: CapaProduto | null; cor: string | null; tamanho: string | null; codigo: string;
  onAbrir: () => void; refBotao: (el: HTMLButtonElement | null) => void;
}) {
  const url = useFotoSku(v, produto);
  return (
    <button
      type="button" ref={refBotao} onClick={onAbrir} aria-label={`Ampliar foto do SKU ${codigo}`}
      className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Imagem url={url} alt={altFoto(cor, tamanho)} className="h-10 w-10 shrink-0 rounded-md object-cover" iconClass="h-4 w-4" />
    </button>
  );
}

export interface LinhaVisualizador {
  codigo: string; cor: string | null; tamanho: string | null; v: Foto | undefined;
  quantidade: number; travada?: boolean;
}

export function VisualizadorSku({ linhas, indice, produto, soma, total, onIndice, onQuantidade, onFechar, onFocoDevolvido }: {
  linhas: LinhaVisualizador[]; indice: number | null; produto: CapaProduto | null; soma: number; total: number | string;
  onIndice: (i: number) => void; onQuantidade: (codigo: string, q: number) => void; onFechar: () => void;
  /** Devolve o foco à miniatura do SKU que estava aberto ao fechar (Esc ou ×). */
  onFocoDevolvido: () => void;
}) {
  const atual = indice != null ? linhas[indice] : undefined;
  const url = useFotoSku(atual?.v, produto);
  // A cada SKU o foco volta ao campo: botão que acabou de desabilitar (extremo) perderia o foco e as setas.
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); }, [atual?.codigo]);
  const mover = (d: number) => {
    if (indice == null) return;
    const i = indice + d;
    if (i >= 0 && i < linhas.length) onIndice(i);
  };
  return (
    <Dialog open={!!atual} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(ev) => { ev.preventDefault(); onFocoDevolvido(); }}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowRight') { ev.preventDefault(); mover(1); }
          if (ev.key === 'ArrowLeft') { ev.preventDefault(); mover(-1); }
        }}
      >
        {atual && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle>{[atual.codigo, atual.cor, atual.tamanho].filter(Boolean).join(' · ')}</DialogTitle>
              <DialogDescription>{soma} de {total} unidades</DialogDescription>
            </DialogHeader>
            <Imagem
              url={url} alt={altFoto(atual.cor, atual.tamanho)} iconClass="h-10 w-10"
              className="h-[min(55vh,26rem)] w-full rounded-md bg-muted object-contain"
            />
            <div className="flex items-end gap-2">
              <Button type="button" size="icon" variant="outline" aria-label="SKU anterior" disabled={indice === 0} onClick={() => mover(-1)}>
                <ChevronLeft />
              </Button>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Quantidade ({(indice ?? 0) + 1}/{linhas.length})</span>
                <Input
                  ref={campo} type="number" min={0} step={1} value={atual.quantidade} disabled={atual.travada}
                  aria-label={`Quantidade no visualizador ${atual.codigo}`}
                  onChange={(ev) => onQuantidade(atual.codigo, Math.round(Number.isFinite(Number(ev.target.value)) ? Number(ev.target.value) : 0))}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); mover(1); } }}
                />
              </label>
              <Button type="button" size="icon" variant="outline" aria-label="Próximo SKU" disabled={indice === linhas.length - 1} onClick={() => mover(1)}>
                <ChevronRight />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
