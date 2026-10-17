import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { abrirSelect, escolherNoSelect } from '@/test/select';
import { describe, expect, it, vi } from 'vitest';
import { EtapaFiscalForm, fiscalCompleto, fiscalVazio } from '../etapa-fiscal-form';

describe('EtapaFiscalForm (ADR-0135 D-9)', () => {
  it('origem nacional só oferece códigos 0/3/4/5/8 no select de origem fiscal', async () => {
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    await abrirSelect(userEvent.setup(), /origem fiscal/i);
    const valores = (await screen.findAllByRole('option')).map((o) => o.textContent!.split(' — ')[0]);
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

  // F2, fix round 1: trocar de uma origem que exige FCI (3/5/8) para uma que não exige
  // precisa LIMPAR o fci no mesmo patch — senão o valor sobrevive escondido (campo oculto) e
  // vai no payload como dado fiscal sujo em silêncio.
  it('trocar origemNfe de 3 para 0 limpa o fci no mesmo patch', async () => {
    const onMudar = vi.fn();
    render(<EtapaFiscalForm
      valor={{ ...fiscalVazio(), origemNfe: '3', fci: 'FCI-ANTIGO' }}
      origem="nacional" onMudar={onMudar}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()}
    />);
    await escolherNoSelect(userEvent.setup(), /origem fiscal/i, '0');
    expect(onMudar).toHaveBeenCalledWith({ origemNfe: '0', fci: '' });
  });

  it('trocar origemNfe de 3 para 5 (ambas exigem FCI) preserva o fci', async () => {
    const onMudar = vi.fn();
    render(<EtapaFiscalForm
      valor={{ ...fiscalVazio(), origemNfe: '3', fci: 'FCI-ATUAL' }}
      origem="nacional" onMudar={onMudar}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()}
    />);
    await escolherNoSelect(userEvent.setup(), /origem fiscal/i, '5');
    expect(onMudar).toHaveBeenCalledWith({ origemNfe: '5' });
  });

  // ADR-0181 D-10: o CSOSN padrão da empresa é SUGERIDO — nunca preenchido sozinho.
  describe('CSOSN padrão de revenda', () => {
    const props = { origem: 'nacional' as const, sugestaoNcm: null, carregandoSugestao: false, onAplicarSugestao: vi.fn() };
    it('mostra o botão, não preenche sozinho e aplica só no clique', () => {
      const onMudar = vi.fn();
      render(<EtapaFiscalForm valor={fiscalVazio()} onMudar={onMudar} csosnPadrao="102" {...props} />);
      expect(onMudar).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: /Usar padrão da empresa \(102\)/ }));
      expect(onMudar).toHaveBeenCalledWith({ tributacaoIcms: '102' });
    });
    it('sem botão quando o CSOSN já está escolhido, não há padrão ou o padrão é inválido', () => {
      const { unmount } = render(<EtapaFiscalForm valor={{ ...fiscalVazio(), tributacaoIcms: '500' }}
        onMudar={vi.fn()} csosnPadrao="102" {...props} />);
      expect(screen.queryByRole('button', { name: /padrão da empresa/ })).toBeNull();
      unmount();
      const r2 = render(<EtapaFiscalForm valor={fiscalVazio()} onMudar={vi.fn()} csosnPadrao={null} {...props} />);
      expect(screen.queryByRole('button', { name: /padrão da empresa/ })).toBeNull();
      r2.unmount();
      render(<EtapaFiscalForm valor={fiscalVazio()} onMudar={vi.fn()} csosnPadrao="999" {...props} />);
      expect(screen.queryByRole('button', { name: /padrão da empresa/ })).toBeNull();
    });
    it('campo Descrição na nota fiscal propaga o texto', () => {
      const onMudar = vi.fn();
      render(<EtapaFiscalForm valor={fiscalVazio()} onMudar={onMudar} {...props} />);
      const input = screen.getByLabelText(/Descrição na nota fiscal/i) as HTMLInputElement;
      expect(input.maxLength).toBe(120);
      fireEvent.change(input, { target: { value: 'Short masculino' } });
      expect(onMudar).toHaveBeenCalledWith({ descricaoFiscal: 'Short masculino' });
    });
  });
});
