import { useDropzone } from 'react-dropzone';
import { ImagePlus } from 'lucide-react';

interface Props {
  onArquivos: (arquivos: File[]) => void;
  desabilitado?: boolean;
}

export function DropZoneImagensExistente({ onArquivos, desabilitado }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/jpeg': ['.jpeg', '.jpg'], 'image/png': ['.png'] },
    disabled: desabilitado,
    onDrop: onArquivos,
  });
  return (
    <div
      {...getRootProps()}
      className={`cursor-pointer rounded-md border-2 border-dashed p-4 text-center text-sm text-foreground transition-colors ${
        isDragActive ? 'border-primary bg-accent' : 'border-border bg-muted/30 hover:bg-muted/50'
      } ${desabilitado ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input {...getInputProps()} data-testid="drop-zone-input" />
      <span className="inline-flex items-center gap-2">
        <ImagePlus className="h-4 w-4 text-muted-foreground" />
        Arraste imagens para atribuir às variações
      </span>
      <div className="mt-1 text-xs text-muted-foreground">
        (aceita 00CODIGO.jpeg / .jpg / .png)
      </div>
    </div>
  );
}
