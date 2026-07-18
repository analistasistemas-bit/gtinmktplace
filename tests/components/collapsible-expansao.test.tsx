// Smoke da Fase 3 (motion): valida a premissa estrutural da expansão da Revisão —
// Radix Collapsible controlado monta o conteúdo ao abrir e desmonta ao fechar
// (sem animação em jsdom o unmount é imediato), igual ao conditional render que
// substituiu em src/pages/Revisao.tsx. Se isso quebrar, a expansão de família
// passa a montar as FamiliaExpanded fechadas (regressão de performance).
import { render, screen } from '@testing-library/react';
import { Collapsible } from 'radix-ui';
import { describe, expect, it } from 'vitest';

function Wrapper({ open }: { open: boolean }) {
  return (
    <Collapsible.Root open={open}>
      <Collapsible.Content className="overflow-hidden">
        <div>conteudo-expandido</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

describe('Collapsible controlado (premissa da expansão da Revisão)', () => {
  it('fechado: conteúdo não montado; aberto: montado; fecha de novo: desmontado', () => {
    const { rerender } = render(<Wrapper open={false} />);
    expect(screen.queryByText('conteudo-expandido')).toBeNull();
    rerender(<Wrapper open={true} />);
    expect(screen.getByText('conteudo-expandido')).toBeInTheDocument();
    rerender(<Wrapper open={false} />);
    expect(screen.queryByText('conteudo-expandido')).toBeNull();
  });
});
