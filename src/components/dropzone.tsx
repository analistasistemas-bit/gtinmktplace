import { useDropzone } from 'react-dropzone';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  label: string;
  accept: Record<string, string[]>;
  multiple: boolean;
  onFiles: (files: File[]) => void;
  files: File[];
}

export function Dropzone({ label, accept, multiple, onFiles, files }: DropzoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple,
    onDrop: onFiles,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        isDragActive ? 'border-primary bg-accent' : 'border-muted-foreground/25 hover:bg-accent/50'
      )}
    >
      <input {...getInputProps()} />
      <p className="text-sm font-medium">{label}</p>
      {files.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {isDragActive ? 'Solte aqui...' : 'Arraste ou clique para selecionar'}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {multiple ? `${files.length} arquivo(s) selecionado(s)` : files[0].name}
        </p>
      )}
    </div>
  );
}
