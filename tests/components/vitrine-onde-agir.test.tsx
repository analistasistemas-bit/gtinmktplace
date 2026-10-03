import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OndeAgir } from '@/components/vitrine/onde-agir';
import { LEGENDA } from '@/components/vitrine/dicas';
import type { ItemAcao, ItemVitrine, Rotulo } from '@/lib/vitrine';

const item = (o: Partial<ItemVitrine> = {}): ItemVitrine => ({
  ml_item_id: 'MLB123', titulo: 'FITA CETIM PROGRESSO N.3 | 10 METROS', codigo_pai: '0042', status: 'active', em_ads: false,
  visitas: 11, pedidos: 1, receita: 10, pares_ok: 28, pares_total: 28,
  visitas_ant: 20, pedidos_ant: 2, receita_ant: 20, pares_ok_ant: 28, pares_total_ant: 28,
  visitas_ult7: 0, dias_ok_ult7: 7, variacao: 'Marsala', permalink: 'https://produto.mercadolivre.com.br/MLB-123-fita', ...o,
});
const acao = (i: ItemVitrine, rotulo: Rotulo = 'sem_venda'): ItemAcao => ({ item: i, rotulo, emJogo: 3 });
const ui = (acoes: ItemAcao[]) => render(<MemoryRouter><OndeAgir acoes={acoes} preset="4s" /></MemoryRouter>);

describe('OndeAgir (linha)', () => {
  it('título formatado e variação', () => {
    ui([acao(item())]);
    expect(screen.getByText('Fita Cetim Progresso N.3 | 10 Metros')).toBeTruthy();
    expect(screen.getByText('Marsala')).toBeTruthy();
  });
  it('link do ML: permalink e fallback', () => {
    const { unmount } = ui([acao(item())]);
    const a = screen.getByRole('link', { name: 'Abrir anúncio no Mercado Livre' });
    expect(a.getAttribute('href')).toBe('https://produto.mercadolivre.com.br/MLB-123-fita');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    unmount();
    ui([acao(item({ permalink: null }))]);
    expect(screen.getByRole('link', { name: 'Abrir anúncio no Mercado Livre' }).getAttribute('href')).toBe('https://produto.mercadolivre.com.br/MLB-123');
  });
  it('sem título mostra o MLB e o selo', () => {
    ui([acao(item({ titulo: null }))]);
    expect(screen.getByText('MLB123')).toBeTruthy();
    expect(screen.getByText('título ainda não coletado')).toBeTruthy();
  });
  it('invisível mostra o normal esperado', () => {
    // esperado7 = (14 - 0) * 7 / (28 - 7) ≈ 4,67 → 5
    ui([acao(item({ visitas: 14 }), 'invisivel')]);
    expect(screen.getByText(/o normal seria ~5/)).toBeTruthy();
  });
});

describe('OndeAgir (ⓘ legenda)', () => {
  for (const [nome, tecla] of [['Enter', '{Enter}'], ['Espaço', ' ']] as const) {
    it(`abre por teclado (${nome}), fecha com Esc e devolve o foco`, async () => {
      const user = userEvent.setup();
      ui([acao(item())]);
      const btn = screen.getByRole('button', { name: 'Como ler: Onde agir' });
      for (let n = 0; n < 20 && document.activeElement !== btn; n++) await user.tab();
      expect(document.activeElement).toBe(btn);
      await user.keyboard(tecla);
      const dlg = screen.getByRole('dialog', { name: /Onde agir/ });
      expect(LEGENDA).toHaveLength(4);
      for (const nome of ['Invisível', 'Vitrine sem venda', 'Converte e ninguém vê', 'Perdendo visitas']) {
        expect(within(dlg).getByText(nome)).toBeTruthy();
      }
      for (const l of LEGENDA) {
        expect(within(dlg).getAllByText(l.significa).length).toBeGreaterThan(0);
        expect(within(dlg).getAllByText(l.fazer).length).toBeGreaterThan(0);
        expect(within(dlg).getAllByText(l.porQue).length).toBeGreaterThan(0);
      }
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(btn);
    });
  }
});
