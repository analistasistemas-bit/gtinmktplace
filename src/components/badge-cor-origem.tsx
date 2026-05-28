import type { CorOrigem } from '@/lib/tipos-dominio';

const ESTILOS: Record<CorOrigem, { bg: string; icone: string; titulo: string }> = {
  descricao: { bg: 'bg-neutral-200 text-neutral-700', icone: '📝', titulo: 'Cor extraída do texto da descrição' },
  vision: { bg: 'bg-blue-100 text-blue-700', icone: '👁', titulo: 'Cor identificada pela IA Vision (foto)' },
  manual: { bg: 'bg-green-100 text-green-700', icone: '✓', titulo: 'Cor editada manualmente pelo operador' },
};

interface Props {
  origem: CorOrigem | null;
}

export function BadgeCorOrigem({ origem }: Props) {
  if (!origem) {
    return (
      <span
        title="Sem cor identificada — revise"
        className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-xs text-red-700"
      >
        ⚠
      </span>
    );
  }
  const e = ESTILOS[origem];
  return (
    <span
      title={e.titulo}
      className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs ${e.bg}`}
    >
      {e.icone}
    </span>
  );
}
