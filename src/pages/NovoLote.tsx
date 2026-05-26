import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/dropzone';

export default function NovoLote() {
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File[]>([]);
  const [imagens, setImagens] = useState<File[]>([]);

  const podeProcessar = planilha.length === 1;

  function handleProcessar() {
    const loteId = `lote-novo-${Date.now()}`;
    navigate(`/progresso/${loteId}`);
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Novo lote</h1>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Dropzone
          label="Planilha (.xlsx)"
          accept={{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }}
          multiple={false}
          onFiles={setPlanilha}
          files={planilha}
        />
        <Dropzone
          label="Imagens (.jpg, .jpeg, .png)"
          accept={{ 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] }}
          multiple={true}
          onFiles={setImagens}
          files={imagens}
        />
        <Button onClick={handleProcessar} disabled={!podeProcessar} size="lg">
          Processar
        </Button>
      </div>
    </div>
  );
}
