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

/** Candidatas na cadeia da lista de Estoque (Storage → foto do ML) e depois a capa do produto;
 *  a imagem tenta a próxima quando uma falha. `variante`: -V miniatura, -O original (visualizador). */
function useFotosSku(v: Foto | undefined, produto: CapaProduto | null, variante: 'V' | 'O'): string[] {
  const { data: propria } = useImageUrl(v?.imagemPath);
  const { data: capa } = useImageUrl(produto?.capaStoragePath);
  return [propria, urlFotoMl(v?.mlPictureId, variante), capa, urlFotoMl(produto?.capaMlPictureId, variante)]
    .filter((u): u is string => !!u);
}

export const altFoto = (cor: string | null | undefined, tamanho: string | null | undefined) =>
  `Foto de ${[cor, tamanho].filter(Boolean).join(' ')}`.trim();

function Imagem({ urls, alt, className, iconClass }: { urls: string[]; alt: string; className: string; iconClass: string }) {
  const [falhas, setFalhas] = useState(0);
  const chave = urls.join('|');
  useEffect(() => { setFalhas(0); }, [chave]);
  const url = urls[falhas];
  if (!url) {
    return (
      <div data-testid="foto-sku-placeholder" className={`${className} flex items-center justify-center bg-muted text-muted-foreground`}>
        <ImageIcon className={iconClass} />
      </div>
    );
  }
  return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFalhas((n) => n + 1)} className={className} />;
}

export function MiniaturaSku({ v, produto, cor, tamanho, codigo, onAbrir, refBotao }: {
  v: Foto | undefined; produto: CapaProduto | null; cor: string | null; tamanho: string | null; codigo: string;
  onAbrir: () => void; refBotao: (el: HTMLButtonElement | null) => void;
}) {
  const urls = useFotosSku(v, produto, 'V');
  return (
    <button
      type="button" ref={refBotao} onClick={onAbrir} aria-label={`Ampliar foto do SKU ${codigo}`}
      className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Imagem urls={urls} alt={altFoto(cor, tamanho)} className="h-10 w-10 shrink-0 rounded-md object-cover" iconClass="h-4 w-4" />
    </button>
  );
}

export interface LinhaVisualizador {
  codigo: string; cor: string | null; tamanho: string | null; v: Foto | undefined; capa: CapaProduto | null;
  quantidade: number; travada?: boolean;
}

export function VisualizadorSku({ linhas, indice, soma, total, onIndice, onQuantidade, onFechar, onFocoDevolvido }: {
  linhas: LinhaVisualizador[]; indice: number | null; soma: number; total: number | string;
  onIndice: (i: number) => void; onQuantidade: (codigo: string, q: number) => void; onFechar: () => void;
  /** Devolve o foco à miniatura do SKU que estava aberto ao fechar (Esc ou ×). */
  onFocoDevolvido: () => void;
}) {
  const atual = indice != null ? linhas[indice] : undefined;
  const urls = useFotosSku(atual?.v, atual?.capa ?? null, 'O');
  // A cada SKU o foco volta ao campo; se ele está travado, ao corpo do diálogo (destino sempre focável:
  // um botão que acabou de desabilitar no extremo perderia o foco, e com ele as setas e o Enter).
  const campo = useRef<HTMLInputElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  useEffect(() => { (atual?.travada ? corpo.current : campo.current)?.focus(); }, [atual?.codigo, atual?.travada]);
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
          // Enter avança a partir do campo de quantidade ou do corpo (linha travada); botões mantêm o Enter deles.
          if (ev.key === 'Enter' && (ev.target === campo.current || ev.target === corpo.current)) { ev.preventDefault(); mover(1); }
        }}
      >
        {atual && (
          <>
            <div ref={corpo} tabIndex={-1} className="grid gap-4 outline-none">
            <DialogHeader className="pr-8">
              <DialogTitle>{[atual.codigo, atual.cor, atual.tamanho].filter(Boolean).join(' · ')}</DialogTitle>
              <DialogDescription>{soma} de {total} unidades</DialogDescription>
            </DialogHeader>
            <Imagem
              urls={urls} alt={altFoto(atual.cor, atual.tamanho)} iconClass="h-10 w-10"
              className="h-[min(55vh,26rem)] w-full rounded-md bg-muted object-contain"
            />
            </div>
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
