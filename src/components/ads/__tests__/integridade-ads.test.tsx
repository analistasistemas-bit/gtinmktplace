import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { IntegridadeAds } from '../integridade-ads';
import type { PainelAds, ContaPainel, ComposicaoConta } from '@/lib/ads-painel';
import { MSG_CONCILIACAO_PENDENTE, montarPainelAds } from '@/lib/ads-painel';

const conta = (o: Partial<ContaPainel> = {}) => ({
  custo: 1000, emFamilias: 600, compartilhado: 250, naoIdentificado: 150, naoIdentificadoPct: 0.15,
  divergente: false, motivoFiscal: null, fonteCusto: 'real', ...o,
}) as unknown as ContaPainel;

const painel = (o: Partial<PainelAds> = {}): PainelAds => ({
  estado: 'ok', desatualizado: false, gruposCobertos: true, semaforoLiberado: true, conta: conta(), contaMotivo: null,
  familias: [], compartilhados: [{ id: 7, custo: 250, familias: ['FAM1', 'FAM2'], semCodigo: 0 }], conciliacao: null, ...o,
});

const COLETADA: ComposicaoConta = { custo: 900, emFamilias: 600, compartilhado: 250, naoIdentificado: 50, naoIdentificadoPct: 0.055, divergente: false };
const props = { janelaDesde: '2026-09-01', historicoDesde: null, coletadoEm: '2026-10-30T15:00:00Z', lidoEm: '2026-10-31T12:30:00Z' };

const dominio = (o: Record<string, unknown> = {}) => montarPainelAds({
  fonte: { sync: { estado: 'ok', erro: null, ultimo_ok_em: '2026-10-04T14:00:00Z', carga_inicial_ok: true,
    cobertura_desde: '2026-06-29', conta_cobertura_desde: '2026-06-29' },
  conta: [{ dia: '2026-09-01', cost: 60, clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0, coletado_em: '2026-10-04T12:00:00Z' }],
  grupos: [] },
  janela: { desde: '2026-09-01', ate: '2026-09-01' }, agora: new Date('2026-10-04T15:00:00-03:00'),
  codigosPorMlb: new Map(), familiaDoCodigo: new Map(), nomeDaFamilia: new Map(), lucroPorFamilia: new Map(),
  lucroConta: { lucro: 300, fonteCusto: 'real' }, baseFiscal: { ok: true }, baseAcosValidada: true,
  historicoDesde: '2026-10-01T03:00:00.000Z', ...o,
});

describe('IntegridadeAds', () => {
  it('histórico: aviso com nenhuma família (domínio)', () => {
    const p = dominio();
    expect(p.familias).toHaveLength(0);
    render(<IntegridadeAds painel={p} {...props} historicoDesde="2026-10-01T03:00:00.000Z" />);
    expect(screen.getByText(/antes do histórico de vendas \(desde 01\/10\/2026\)/i)).toBeTruthy();
  });

  it('cobertura e histórico juntos (domínio)', () => {
    const p = dominio({ fonte: { sync: null, conta: [], grupos: [] } });
    expect(p.gruposCobertos).toBe(false);
    render(<IntegridadeAds painel={p} {...props} historicoDesde="2026-10-01T03:00:00.000Z" />);
    expect(screen.getByText(/coleta de Ads incompleta no período/i)).toBeTruthy();
    expect(screen.getByText(/antes do histórico de vendas/i)).toBeTruthy();
  });

  it('histórico cobrindo a janela: sem aviso', () => {
    render(<IntegridadeAds painel={dominio({ historicoDesde: '2026-01-01T03:00:00.000Z' })} {...props} historicoDesde="2026-01-01T03:00:00.000Z" />);
    expect(screen.queryByText(/antes do histórico/i)).toBeNull();
  });

  it('mostra compartilhado e não identificado em texto, sem tooltip', () => {
    render(<IntegridadeAds painel={painel()} {...props} />);
    expect(screen.getByText('Gasto compartilhado entre famílias: não foi rateado.')).toBeTruthy();
    expect(screen.getByText('Gasto de Ads não identificado: incluído no investimento da conta, sem distribuição entre famílias.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Compartilhado entre famílias/ })).toBeTruthy();
  });

  it('cobertura incompleta e histórico aparecem como texto', () => {
    render(<IntegridadeAds painel={painel({ gruposCobertos: false, familias: [{ motivo: 'historico' } as never] })}
      {...props} historicoDesde="2026-09-01T12:00:00Z" />);
    expect(screen.getByText(/coleta de Ads incompleta no período/i)).toBeTruthy();
    expect(screen.getByText(/antes do histórico de vendas \(desde 01\/09\/2026\)/i)).toBeTruthy();
  });

  it('motivo fiscal da conta aparece', () => {
    render(<IntegridadeAds painel={painel({ conta: conta({ motivoFiscal: 'aliquotas_nao_confirmadas' }) })} {...props} />);
    expect(screen.getByText(/confirme as alíquotas em Configurações/i)).toBeTruthy();
  });

  it('desatualizada e origem com horários', () => {
    render(<IntegridadeAds painel={painel({ desatualizado: true })} {...props} />);
    expect(screen.getByText(/coleta desatualizada/i)).toBeTruthy();
    const origem = screen.getByRole('region', { name: /Origem dos números/i });
    expect(within(origem).getByText(/Leitura do ML/)).toBeTruthy();
    expect(within(origem).getByText(/Coleta das famílias/)).toBeTruthy();
  });

  it('conciliação pendente: mensagem, horário da coleta e composição coletada rotulada', () => {
    render(<IntegridadeAds painel={painel({ conciliacao: { estado: 'pendente', mensagem: MSG_CONCILIACAO_PENDENTE,
      coletadoEm: '2026-10-30T15:00:00Z', coletada: COLETADA, coletadaMotivo: null } })} {...props} />);
    expect(screen.getByText(MSG_CONCILIACAO_PENDENTE)).toBeTruthy();
    const col = screen.getByRole('group', { name: /Composição coletada/i });
    expect(col.textContent).toMatch(/30\/10/);
    expect(col.textContent).toMatch(/R\$\s*50,00/);
  });

  it('conciliação pendente sem coletada: mostra o motivo', () => {
    render(<IntegridadeAds painel={painel({ conciliacao: { estado: 'pendente', mensagem: MSG_CONCILIACAO_PENDENTE,
      coletadoEm: null, coletada: null, coletadaMotivo: 'cobertura' } })} {...props} />);
    expect(screen.getByText(/composição coletada indisponível: coleta incompleta/i)).toBeTruthy();
  });

  it('contraste: nenhum texto destructive/danger sobre fundo /10', () => {
    const { container } = render(<IntegridadeAds painel={painel({ desatualizado: true, gruposCobertos: false,
      conciliacao: { estado: 'pendente', mensagem: MSG_CONCILIACAO_PENDENTE, coletadoEm: null, coletada: null, coletadaMotivo: 'cobertura' } })} {...props} />);
    for (const el of Array.from(container.querySelectorAll('*'))) {
      if (!/text-(destructive|danger)/.test(el.getAttribute('class') ?? '')) continue;
      for (let a: Element | null = el; a && a !== container.parentElement; a = a.parentElement) {
        expect(/bg-\S+\/10/.test(a.getAttribute('class') ?? '')).toBe(false);
      }
    }
  });
});
