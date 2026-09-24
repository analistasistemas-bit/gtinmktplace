import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CardCampanha } from '../card-campanha';
import type { Promocao } from '@/lib/promocoes';

const agora = Date.parse('2026-10-06T12:00:00Z');
const base: Promocao = {
  promocao_id: 'P-1', tipo: 'DEAL', nome: '10.10', status: 'pending', inicio: null, fim: null,
  prazo_adesao: new Date(agora + 24 * 3_600_000).toISOString(), beneficios: null, erro: null, itens_sincronizados_em: null,
  rodada_em_curso: null,
  contagem: { convidados: 504, convidados_verde: 310, participando: 0, verde: 310, amarelo: 120, vermelho: 40, indisponivel: 34, participando_vermelho: 0, ml_pct_max: null },
};
const renderCard = (p: Promocao) => render(<MemoryRouter><CardCampanha promocao={p} agoraMs={agora} /></MemoryRouter>);

describe('CardCampanha', () => {
  it('mostra convidados, contagem e prazo urgente; link para o detalhe', () => {
    renderCard(base);
    expect(screen.getByText('504 anúncios convidados')).toBeTruthy();
    expect(screen.getByText('310')).toBeTruthy();
    expect(screen.getByText(/Adesão até/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/promocoes/P-1');
  });

  it('participando no prejuízo aparece em destaque', () => {
    renderCard({ ...base, status: 'started', contagem: { ...base.contagem!, participando: 12, participando_vermelho: 2 } });
    expect(screen.getByText('2 participando com líquido abaixo do custo')).toBeTruthy();
  });

  it('ML banca: maior parte bancada entre os anúncios', () => {
    renderCard({ ...base, contagem: { ...base.contagem!, ml_pct_max: 30 } });
    expect(screen.getByText(/ML banca até 30%/)).toBeTruthy();
  });

  it('cupom: informativo, sem contagem e sem link', () => {
    renderCard({ ...base, tipo: 'SELLER_COUPON_CAMPAIGN', contagem: null });
    expect(screen.getByText('Cupom vale no carrinho; sem cálculo de líquido.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('nenhuma palavra proibida', () => {
    const { container } = renderCard(base);
    expect(container.textContent).not.toMatch(/margem|lucro|candidato/i);
  });
});
