import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from '@/components/stepper';

const ETAPAS = ['Upload', 'Parse', 'Match imagens', 'Concorrência', 'Copy IA'];

describe('Stepper', () => {
  it('renderiza todas as etapas', () => {
    render(<Stepper etapas={ETAPAS} atual={0} />);
    ETAPAS.forEach((e) => {
      expect(screen.getByText(e)).toBeInTheDocument();
    });
  });

  it('marca etapa atual com label "atual"', () => {
    render(<Stepper etapas={ETAPAS} atual={2} />);
    const atualLabel = screen.getByLabelText('Etapa atual: Match imagens');
    expect(atualLabel).toBeInTheDocument();
  });

  it('marca etapas anteriores como concluídas', () => {
    render(<Stepper etapas={ETAPAS} atual={3} />);
    expect(screen.getByLabelText('Etapa concluída: Upload')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa concluída: Parse')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa concluída: Match imagens')).toBeInTheDocument();
  });
});
