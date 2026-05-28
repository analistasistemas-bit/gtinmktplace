import type { CorOrigem } from '@/lib/tipos-dominio';

const ESTILOS: Record<CorOrigem, { bg: string; rotulo: string }> = {
  descricao: { bg: 'bg-neutral-200 text-neutral-700', rotulo: '📝 descrição' },
  vision: { bg: 'bg-blue-100 text-blue-700', rotulo: '👁 IA Vision' },
  manual: { bg: 'bg-green-100 text-green-700', rotulo: '✓ manual' },
};

interface Props {
  origem: CorOrigem | null;
}

export function BadgeCorOrigem({ origem }: Props) {
  if (!origem) {
    return (
      <span className="inline-block whitespace-nowrap rounded bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
        ⚠ sem cor
      </span>
    );
  }
  const e = ESTILOS[origem];
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-medium ${e.bg}`}>
      {e.rotulo}
    </span>
  );
}
