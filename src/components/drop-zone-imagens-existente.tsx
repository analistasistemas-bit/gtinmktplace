import { useDropzone } from 'react-dropzone';

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
      className={`border-2 border-dashed rounded-md p-4 text-sm text-center cursor-pointer ${
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-neutral-300 bg-neutral-50'
      } ${desabilitado ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input {...getInputProps()} data-testid="drop-zone-input" />
      📷 Arraste imagens para atribuir às variações
      <div className="text-xs text-neutral-500 mt-1">
        (aceita 00CODIGO.jpeg / .jpg / .png)
      </div>
    </div>
  );
}
