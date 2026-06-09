import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Progress } from '@/components/ui/progress';
import { Dropzone } from '@/components/dropzone';
import { acumularImagens, filtrarImagens } from '@/lib/acumular-imagens';
import { useUploadLote } from '@/hooks/useUploadLote';

export default function NovoLote() {
  const navigate = useNavigate();
  const [planilha, setPlanilha] = useState<File[]>([]);
  const [imagens, setImagens] = useState<File[]>([]);
  const pastaInputRef = useRef<HTMLInputElement>(null);
  const { status, progresso, erro, iniciar } = useUploadLote();

  function adicionarImagens(novas: File[]) {
    setImagens((atuais) => acumularImagens(atuais, novas));
  }

  function handlePasta(e: React.ChangeEvent<HTMLInputElement>) {
    const selecionadas = filtrarImagens(Array.from(e.target.files ?? []));
    if (selecionadas.length > 0) adicionarImagens(selecionadas);
    e.target.value = '';
  }

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
      <PageHeader title="Novo lote" subtitle="Envie a planilha e as imagens do lote para processar." />
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Dropzone
          label="Planilha (.xlsx)"
          accept={{ 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }}
          multiple={false}
          onFiles={setPlanilha}
          files={planilha}
        />
        <div className="flex flex-col gap-2">
          <Dropzone
            label="Imagens (.jpg, .jpeg, .png)"
            accept={{ 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] }}
            multiple={true}
            onFiles={adicionarImagens}
            files={imagens}
            hint="Arraste as pastas aqui (pode ser várias de uma vez) ou use o botão abaixo. As fotos acumulam."
          />
          <input
            ref={pastaInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error -- atributos não-padrão para selecionar uma pasta inteira
            webkitdirectory=""
            directory=""
            multiple
            onChange={handlePasta}
          />
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pastaInputRef.current?.click()}
            >
              <FolderPlus className="mr-2 h-4 w-4" />
              Selecionar pasta (inclui subpastas)
            </Button>
            {imagens.length > 0 && (
              <button
                type="button"
                onClick={() => setImagens([])}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Limpar imagens
              </button>
            )}
          </div>
        </div>

        {(enviando || status === 'concluido') && (
          <div className="flex flex-col gap-2">
            <Progress value={progresso} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {status === 'criando' && 'Criando lote...'}
              {status === 'enviando' && `Enviando arquivos... ${progresso}%`}
              {status === 'processando' && 'Processando planilha...'}
              {status === 'concluido' && 'Concluído!'}
            </p>
          </div>
        )}

        {erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{erro}</p>
        )}

        <Button onClick={handleProcessar} disabled={!podeProcessar || enviando} size="lg">
          {enviando ? 'Enviando...' : 'Processar'}
        </Button>
      </div>
    </div>
  );
}
