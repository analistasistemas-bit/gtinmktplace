import { useRef } from 'react';
import { Camera } from 'lucide-react';

interface Props {
  onArquivo: (arquivo: File) => void;
  desabilitado?: boolean;
  /** Liga o botão ao bloco de crítica correspondente (ex.: "sem foto") via aria-describedby. */
  describedBy?: string;
}

export function BotaoTrocarFoto({ onArquivo, desabilitado, describedBy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Trocar foto"
        aria-describedby={describedBy}
        disabled={desabilitado}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="w-4 h-4" />
      </button>
      <input
        ref={inputRef}
        data-testid="input-trocar-foto"
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArquivo(f);
          e.target.value = '';
        }}
      />
    </>
  );
}
