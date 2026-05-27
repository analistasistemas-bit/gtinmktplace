import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/dropzone';
import { useUploadLote } from '@/hooks/useUploadLote';

export default function NovoLote() {
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File[]>([]);
  const [imagens, setImagens] = useState<File[]>([]);
  const { status, progresso, erro, iniciar } = useUploadLote();

  const podeProcessar = planilha.length === 1 && imagens.length > 0;
  const enviando = status !== 'idle' && status !== 'erro' && status !== 'concluido';

  async function handleProcessar() {
    if (!podeProcessar) return;
    try {
      const r = await iniciar(planilha[0], imagens);
      navigate(`/progresso/${r.loteId}`);
    } catch {
      // erro já exposto pelo hook
    }
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

        {(enviando || status === 'concluido') && (
          <div className="flex flex-col gap-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progresso}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {status === 'criando' && 'Criando lote...'}
              {status === 'enviando' && `Enviando arquivos... ${progresso}%`}
              {status === 'processando' && 'Processando planilha...'}
              {status === 'concluido' && 'Concluído!'}
            </p>
          </div>
        )}

        {erro && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
        )}

        <Button onClick={handleProcessar} disabled={!podeProcessar || enviando} size="lg">
          {enviando ? 'Enviando...' : 'Processar'}
        </Button>
      </div>
    </div>
  );
}
