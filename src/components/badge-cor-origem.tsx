import type { CorOrigem } from '@/lib/tipos-dominio';

const ESTILOS: Record<CorOrigem, { bg: string; icone: string; titulo: string }> = {
  descricao: { bg: 'bg-neutral-200 text-neutral-700', icone: '📝', titulo: 'Cor extraída do texto da descrição' },
  vision: { bg: 'bg-blue-100 text-blue-700', icone: '👁', titulo: 'Cor identificada pela IA Vision (foto)' },
  manual: { bg: 'bg-green-100 text-green-700', icone: '✓', titulo: 'Cor editada manualmente pelo operador' },
};

interface Props {
  origem: CorOrigem | null;
}

function BadgeComTooltip({ bg, icone, titulo }: { bg: string; icone: string; titulo: string }) {
  return (
    <span className="group relative inline-flex">
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs ${bg}`}
      >
        {icone}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-[11px] text-background shadow-md group-hover:block"
      >
        {titulo}
      </span>
    </span>
  );
}

export function BadgeCorOrigem({ origem }: Props) {
  if (!origem) {
    return (
      <BadgeComTooltip
        bg="bg-red-100 text-red-700"
        icone="⚠"
        titulo="Sem cor identificada — revise"
      />
    );
  }
  const e = ESTILOS[origem];
  return <BadgeComTooltip bg={e.bg} icone={e.icone} titulo={e.titulo} />;
}
