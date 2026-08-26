import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EtapaFiscalForm, fiscalCompleto, fiscalVazio } from '../etapa-fiscal-form';

describe('EtapaFiscalForm (ADR-0135 D-9)', () => {
  it('origem nacional só oferece códigos 0/3/4/5/8 no select de origem fiscal', () => {
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    const select = screen.getByLabelText(/origem fiscal/i) as HTMLSelectElement;
    const valores = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(valores).toEqual(['0', '3', '4', '5', '8']);
  });
  it('sugestão de NCM aparece marcada como sugestão e só entra no clique', () => {
    const aplicar = vi.fn();
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={{ ncm: '39269090', justificativa: 'plástico' }} carregandoSugestao={false}
      onAplicarSugestao={aplicar} />);
    expect(screen.getByText(/Sugerida por IA — confira/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /39269090/ }));
    expect(aplicar).toHaveBeenCalled();
  });
  it('fiscalCompleto exige ncm 8 dígitos + origemNfe coerente + csosn', () => {
    expect(fiscalCompleto(fiscalVazio(), 'nacional')).toBe(false);
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '0', tributacaoIcms: '102' }, 'nacional')).toBe(true);
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '1', tributacaoIcms: '102' }, 'nacional')).toBe(false);
  });
});
