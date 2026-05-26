import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Stepper } from '@/components/stepper';

const ETAPAS = [
  'Upload concluído',
  'Parse da planilha',
  'Match de imagens',
  'Detecção CREATE/UPDATE',
  'Busca de concorrência',
  'Geração de copy IA',
];

export default function Progresso() {
  const { loteId } = useParams();
  const navigate = useNavigate();
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    if (atual >= ETAPAS.length) return;
    const timer = setTimeout(() => setAtual((a) => a + 1), 2000);
    return () => clearTimeout(timer);
  }, [atual]);

  const concluido = atual >= ETAPAS.length;
  const progressoPct = Math.min(100, Math.round((atual / ETAPAS.length) * 100));

  return (
    <div className="p-6">
      <h1 className="mb-1 text-2xl font-semibold">Processando lote</h1>
      <p className="mb-4 text-sm text-muted-foreground">ID: {loteId}</p>

      <div className="mx-auto max-w-2xl">
        <Progress value={progressoPct} className="mb-4" />

        <Stepper etapas={ETAPAS} atual={concluido ? ETAPAS.length : atual} />

        <div className="mt-6 rounded-md border bg-card p-4 text-sm">
          <div className="font-semibold mb-2">Resumo do lote</div>
          <p className="text-muted-foreground">
            38 famílias detectadas · 142 variações · 137 imagens matched · 5 órfãs
          </p>
        </div>

        {concluido && (
          <Button onClick={() => navigate('/revisao/lote-42')} size="lg" className="mt-6 w-full">
            Revisar lote
          </Button>
        )}
      </div>
    </div>
  );
}
