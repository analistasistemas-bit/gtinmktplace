import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { abrirSelect, escolherNoSelect } from '@/test/select';
import { describe, expect, it, vi } from 'vitest';
import {
  EtapaFiscalForm, fiscalCompleto, fiscalVazio, confirmacoesNotaOk, confirmacoesAposMudanca, CONFIRMACOES_VAZIAS,
  type ConfirmacoesNota,
} from '../etapa-fiscal-form';

describe('EtapaFiscalForm (ADR-0135 D-9)', () => {
  it('origem nacional só oferece códigos 0/3/4/5/8 no select de origem fiscal', async () => {
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    await abrirSelect(userEvent.setup(), /origem fiscal/i);
    const valores = (await screen.findAllByRole('option')).map((o) => o.textContent!.split(' — ')[0]);
    expect(valores).toEqual(['0', '3', '4', '5', '8']);
  });
  it.each([['0', { fci: '' }], ['3', {}], ['4', { fci: '' }], ['5', {}], ['8', {}]])(
    'escolher a origem %s no select envia { origemNfe } ao onMudar', async (codigo, extra) => {
      const onMudar = vi.fn();
      render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={onMudar}
        sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
      await escolherNoSelect(userEvent.setup(), /origem fiscal/i, codigo);
      expect(onMudar).toHaveBeenCalledWith({ origemNfe: codigo, ...extra });
    });
  it('escolher um CSOSN no select envia { tributacaoIcms } ao onMudar', async () => {
    const onMudar = vi.fn();
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={onMudar}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    await escolherNoSelect(userEvent.setup(), 'CSOSN', '102');
    expect(onMudar).toHaveBeenCalledWith({ tributacaoIcms: '102' });
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
  it('colar NCM com pontos (6203.49.00) normaliza para 62034900 (maxLength não trunca antes)', async () => {
    const onMudar = vi.fn();
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={onMudar}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('NCM'));
    await user.paste('6203.49.00');
    expect(onMudar).toHaveBeenLastCalledWith({ ncm: '62034900' });
  });
  it.each([
    ['ok', { status: 'ok', descricao: 'Calças › De outras' }, '6203.49.00 — Calças › De outras'],
    ['inexistente', { status: 'inexistente', descricao: null }, 'NCM 75937727 não existe na tabela oficial'],
    ['vencido', { status: 'vencido', descricao: 'Velho' }, 'NCM 75937727 não está mais vigente'],
    ['erro', { status: 'erro', descricao: null }, 'Não foi possível verificar o NCM'],
  ] as const)('mostra o resultado da consulta oficial (%s)', (_n, ncmOficial, texto) => {
    const ncm = ncmOficial.status === 'ok' ? '62034900' : '75937727';
    render(<EtapaFiscalForm valor={{ ...fiscalVazio(), ncm }} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()} ncmOficial={ncmOficial} />);
    expect(screen.getByText(texto)).toBeInTheDocument();
  });
  it('fiscalCompleto exige ncm 8 dígitos + origemNfe coerente + csosn + NCM oficial ok', () => {
    expect(fiscalCompleto(fiscalVazio(), 'nacional', 'ok')).toBe(false);
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '0', tributacaoIcms: '102' }, 'nacional', 'ok')).toBe(true);
    for (const st of ['incompleto', 'carregando', 'inexistente', 'vencido', 'erro'] as const) {
      expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '0', tributacaoIcms: '102' }, 'nacional', st)).toBe(false);
    }
    expect(fiscalCompleto({ ...fiscalVazio(), ncm: '39269090', origemNfe: '1', tributacaoIcms: '102' }, 'nacional', 'ok')).toBe(false);
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

describe('confirmacoes da nota (ADR-0181 D-10)', () => {
  const ok: ConfirmacoesNota = { conferido: true, semCestVigente: false, interestadualConferido: false };
  const av = (o: object = {}) => ({ classe: 'sem_st' as const, codigoFornecedor: '102', semCest: false, interestadual: false, semPadrao: false, ...o });
  it('confirmacoesNotaOk', () => {
    expect(confirmacoesNotaOk(fiscalVazio(), undefined, ok)).toBe(true);
    expect(confirmacoesNotaOk(fiscalVazio(), av({ semCest: true }), ok)).toBe(false);
    expect(confirmacoesNotaOk(fiscalVazio(), av({ semCest: true }), { ...ok, semCestVigente: true })).toBe(true);
    expect(confirmacoesNotaOk({ ...fiscalVazio(), cest: '2805900' }, av({ semCest: true }), ok)).toBe(true);
    expect(confirmacoesNotaOk(fiscalVazio(), av({ interestadual: true }), ok)).toBe(false);
    expect(confirmacoesNotaOk(fiscalVazio(), av({ interestadual: true }), { ...ok, interestadualConferido: true })).toBe(true);
    expect(confirmacoesNotaOk(fiscalVazio(), undefined, { ...ok, conferido: false })).toBe(false);
  });
  it('confirmacoesAposMudanca: matriz de invalidação', () => {
    const tudo: ConfirmacoesNota = { conferido: true, semCestVigente: true, interestadualConferido: true };
    const f = fiscalVazio();
    expect(confirmacoesAposMudanca(tudo, f, { ...f, ncm: '1' })).toEqual({ conferido: false, semCestVigente: false, interestadualConferido: true });
    expect(confirmacoesAposMudanca(tudo, f, { ...f, cest: '1' })).toEqual({ conferido: false, semCestVigente: false, interestadualConferido: true });
    expect(confirmacoesAposMudanca(tudo, f, { ...f, tributacaoIcms: '102' })).toEqual({ conferido: false, semCestVigente: true, interestadualConferido: false });
    expect(confirmacoesAposMudanca(tudo, f, { ...f, origemNfe: '0' })).toEqual({ conferido: false, semCestVigente: true, interestadualConferido: true });
    expect(confirmacoesAposMudanca(tudo, f, { ...f, fci: 'X' })).toEqual({ conferido: false, semCestVigente: true, interestadualConferido: true });
    expect(confirmacoesAposMudanca(tudo, f, { ...f, exTipi: '01' })).toEqual(tudo);
  });
  it('exceção: mostra o código do fornecedor e a orientação do contador, sem "Usar padrão"', () => {
    render(<EtapaFiscalForm valor={fiscalVazio()} origem="nacional" onMudar={vi.fn()}
      sugestaoNcm={null} carregandoSugestao={false} onAplicarSugestao={vi.fn()}
      csosnPadrao="102" sugestaoDaNota confirmacoes={CONFIRMACOES_VAZIAS}
      avisosNota={av({ classe: 'excecao', codigoFornecedor: '400' })} />);
    expect(screen.getByText(/O fornecedor usou 400/)).toBeInTheDocument();
    expect(screen.getByText('300 — operação imune ao ICMS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usar padrão da empresa/ })).not.toBeInTheDocument();
  });
});
