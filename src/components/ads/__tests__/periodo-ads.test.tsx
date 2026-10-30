import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodoAdsSeletor } from '@/components/ads/periodo-ads';
import { escolherNoSelect } from '@/test/select';
import type { PeriodoAds } from '@/lib/ads-painel-dados';

// 30/10/2026 12:00 BRT → "ontem" = 2026-10-29.
const AGORA = new Date('2026-10-30T15:00:00Z');

function montar(valor: PeriodoAds = { tipo: 'mes_atual' }, comparar: 'anterior' | 'nenhum' = 'anterior') {
  const onChange = vi.fn();
  render(<PeriodoAdsSeletor valor={valor} comparar={comparar} onChange={onChange} agora={AGORA} />);
  return onChange;
}

async function abrirPersonalizado(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Personalizado' }));
}

const digitar = (rotulo: string, v: string) =>
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: v } });

describe('PeriodoAdsSeletor', () => {
  it('mostra os presets do /ads e nunca "Hoje"', () => {
    montar();
    for (const n of ['Mês atual', '7 dias', '30 dias', '90 dias', 'Personalizado']) {
      expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
    }
    expect(screen.queryByText('Hoje')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mês atual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicar num preset chama onChange com o período e a comparação atual', async () => {
    const onChange = montar();
    await userEvent.setup().click(screen.getByRole('button', { name: '30 dias' }));
    expect(onChange).toHaveBeenCalledWith({ periodo: { tipo: 'preset', dias: 30 }, comparar: 'anterior' });
  });

  it('digitar datas não dispara onChange; Aplicar envia o range válido', async () => {
    const user = userEvent.setup();
    const onChange = montar();
    await abrirPersonalizado(user);
    digitar('De', '2026-10-01');
    digitar('Até', '2026-10-15');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      periodo: { tipo: 'range', desde: '2026-10-01', ate: '2026-10-15' },
      comparar: 'anterior',
    });
  });

  it.each([
    ['ordem', '2026-10-20', '2026-10-10', /início.*depois do fim/i],
    ['futuro', '2026-10-01', '2026-10-30', /ontem/i],
    ['fora da retenção', '2026-06-01', '2026-06-10', /91 dias/i],
    ['data inválida', '', '2026-10-10', /datas válidas/i],
  ])('range inválido (%s) mostra o motivo e não envia', async (_n, de, ate, motivo) => {
    const user = userEvent.setup();
    const onChange = montar();
    await abrirPersonalizado(user);
    digitar('De', de);
    digitar('Até', ate);
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(screen.getByRole('alert')).toHaveTextContent(motivo);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('trocar a comparação chama onChange mantendo o período', async () => {
    const user = userEvent.setup();
    const onChange = montar({ tipo: 'preset', dias: 7 });
    await escolherNoSelect(user, 'Comparar com', 'Sem comparação');
    expect(onChange).toHaveBeenCalledWith({ periodo: { tipo: 'preset', dias: 7 }, comparar: 'nenhum' });
  });

  it('expõe grupo rotulado e campos de data com labels', async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.getByRole('group', { name: 'Período' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Comparar com' })).toBeInTheDocument();
    await abrirPersonalizado(user);
    expect(screen.getByLabelText('De')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Até')).toHaveAttribute('type', 'date');
  });
});
