import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuraTransferencia, EtapaTransferencia } from '../transferencia-andamento';

const ativa = {
  id: 'T1', tipo: 'montar', estado: 'ativa', passo: 'aumentar', alerta: 'quarentena', criadoEm: '2026-11-08T10:00:00Z',
  quarentenaAte: null, criacao: true,
};

describe('indicador de transferência de kit', () => {
  it('ativa: aura + raio na borda e a etapa em linguagem simples com passo X de N', () => {
    const { container } = render(
      <AuraTransferencia estado="ativa"><EtapaTransferencia t={ativa} /></AuraTransferencia>,
    );
    expect(container.querySelector('.glow-effect-sombra')).not.toBeNull();
    expect(container.querySelector('.border-trail__track')).not.toBeNull();
    expect(screen.getByText(/Criando o anúncio do kit no Mercado Livre/)).toBeInTheDocument();
    expect(screen.getByText(/passo 7 de 9/)).toBeInTheDocument();
    // Motivo técnico de reagendamento nunca aparece como alerta.
    expect(screen.queryByText(/quarentena/)).not.toBeInTheDocument();
  });

  it('travada: neon vermelho parado, sem raio, com o alerta e o que fazer', () => {
    const { container } = render(
      <AuraTransferencia estado="travada">
        <EtapaTransferencia t={{ ...ativa, estado: 'travada', alerta: 'Leitura divergente em KIT-M' }} />
      </AuraTransferencia>,
    );
    const aura = container.querySelector('[data-estado="travada"]');
    expect(aura).not.toBeNull();
    expect(container.querySelector('.glow-effect-sombra')).toBeNull();
    expect(container.querySelector('.border-trail__track')).toBeNull();
    expect(screen.getByText(/Travou/)).toBeInTheDocument();
    expect(screen.getByText(/Leitura divergente em KIT-M/)).toBeInTheDocument();
    expect(screen.getByText(/ficam pausados até alguém resolver/)).toBeInTheDocument();
  });

  it('sem transferência: nenhum efeito', () => {
    const { container } = render(<AuraTransferencia estado={null}><span>kit</span></AuraTransferencia>);
    expect(container.querySelector('.glow-effect-sombra')).toBeNull();
    expect(container.querySelector('.border-trail__track')).toBeNull();
  });
});
