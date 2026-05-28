import { useRef } from 'react';
import { Camera } from 'lucide-react';

interface Props {
  onArquivo: (arquivo: File) => void;
  desabilitado?: boolean;
}

export function BotaoTrocarFoto({ onArquivo, desabilitado }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Trocar foto"
        disabled={desabilitado}
        className="p-1 rounded hover:bg-neutral-100 disabled:opacity-50"
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
