// Campo de escolha de foto reutilizável (Estoque > Cadastrar produto). Substitui o
// <input type="file"> nativo — que renderiza "Escolher arquivo | Nenhum arquivo escolhido",
// destoando do resto do design system shadcn — por uma zona de arraste/clique com preview.
// react-dropzone já é dependência do projeto (mesmo padrão de drop-zone-imagens-existente.tsx
// e dropzone.tsx) — não introduz biblioteca nova.
import { useLayoutEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Regressão achada via Playwright ao vivo: `useMemo(() => URL.createObjectURL(file), [file])`
// + `useEffect(() => () => URL.revokeObjectURL(url), [url])` quebra sob React 18 StrictMode em
// dev — o efeito roda mount → unmount (revoga a URL) → remount, mas o useMemo NÃO recalcula
// porque `file` não mudou: sobra uma URL revogada presa no <img>. Fix: criar E revogar a URL
// dentro do MESMO efeito — o StrictMode reexecuta o efeito inteiro no remount, então gera uma
// URL nova em vez de reaproveitar a revogada. useLayoutEffect (não useEffect) só para não
// piscar "sem imagem" por um frame a cada montagem.
export function MiniaturaFoto({ file, alt, className }: { file: File; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useLayoutEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (!url) return null;
  return <img src={url} alt={alt} className={cn('h-14 w-14 shrink-0 rounded-md object-cover', className)} />;
}

export function CampoFoto({
  id, ariaLabel, arquivo, onEscolher, disabled, enviada, opcional, onTrocar,
}: {
  id: string;
  /** Nome acessível do input real — precisa bater com o que os testes/scripts buscam via
   *  `getByLabelText` (ex.: "Capa", "Foto da variação 1", código do SKU). */
  ariaLabel: string;
  arquivo: File | null;
  onEscolher: (file: File | null) => void;
  disabled?: boolean;
  /** true: alvo já subiu pro servidor — mostra "✓ enviada" + Trocar, sem input no DOM (senão o
   *  operador lê a reaparição do campo como "perdi minha foto" — item 1 da auditoria). */
  enviada?: boolean;
  /** true: mostra "(opcional)" quando ainda não há arquivo escolhido. */
  opcional?: boolean;
  onTrocar?: () => void;
}) {
  // Hook sempre chamado, mesmo quando `enviada` esconde a zona de drop — o early return fica
  // DEPOIS do hook (regra dos hooks: nunca antes).
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    multiple: false,
    disabled: disabled || enviada,
    onDrop: (files) => { if (files[0]) onEscolher(files[0]); },
  });

  if (enviada) {
    return (
      <div className="flex h-20 items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
        {arquivo && <MiniaturaFoto file={arquivo} alt={`Prévia de ${ariaLabel}`} className="h-14 w-14" />}
        <span className="flex-1 text-xs text-success">✓ enviada</span>
        <Button
          type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-xs"
          onClick={onTrocar}
        >
          Trocar
        </Button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-2 text-center transition-colors',
        isDragActive ? 'border-primary bg-accent' : 'border-border bg-muted/30 hover:bg-muted/50',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <input {...getInputProps({ id, 'aria-label': ariaLabel, disabled })} />
      {arquivo ? (
        <div className="flex w-full items-center gap-2">
          <MiniaturaFoto file={arquivo} alt={`Prévia de ${ariaLabel}`} className="h-10 w-10" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{arquivo.name}</span>
          <button
            type="button"
            aria-label={`Remover ${ariaLabel}`}
            // stopPropagation: o botão é filho da zona de drop (getRootProps), que abre o
            // seletor de arquivo em qualquer clique — sem isto, clicar em "Remover" também
            // reabriria o seletor por baixo.
            onClick={(e) => { e.stopPropagation(); onEscolher(null); }}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <ImagePlus className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{isDragActive ? 'Solte aqui' : 'Escolher foto'}</span>
          {opcional && <span className="text-[10px] text-muted-foreground/70">(opcional)</span>}
        </>
      )}
    </div>
  );
}
