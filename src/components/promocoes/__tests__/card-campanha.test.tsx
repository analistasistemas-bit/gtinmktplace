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
    expect(screen.getByText('504')).toBeTruthy();
    expect(screen.getByText(/convidados/i)).toBeTruthy();
    expect(screen.getAllByText('310').length).toBeGreaterThan(0);
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

  it('sem contagem e com erro: rótulo curto, texto técnico só no title', () => {
    const erro = 'ML 500 em /seller-promotions/P-1/items';
    renderCard({ ...base, contagem: null, erro });
    expect(screen.queryByText(erro)).toBeNull();
    expect(screen.getByText('Não foi possível ler os anúncios').closest('[title]')?.getAttribute('title')).toBe(erro);
  });

  it('sem contagem e sem erro: ainda não lidos', () => {
    renderCard({ ...base, contagem: null });
    expect(screen.getByText('Anúncios ainda não lidos')).toBeTruthy();
  });

  // Black Friday 12/11: card dizia 123 "vale a pena" (convidados + participando) e o detalhe abria com 72 (só convidados).
  it('com o recorte por grupo: barra só dos convidados e linha própria de participando', () => {
    renderCard({ ...base, status: 'started', contagem: {
      convidados: 330, convidados_verde: 72, participando: 76, verde: 123, amarelo: 263, vermelho: 17, indisponivel: 3,
      participando_vermelho: 0, ml_pct_max: null,
      convidados_semaforo: { verde: 72, amarelo: 238, vermelho: 17, indisponivel: 3 },
    } });
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('72 vale a pena, 238 abaixo do piso, 17 prejuízo, 3 sem líquido');
    expect(screen.queryByText('123')).toBeNull();
    expect(screen.getByText('Participando: 51 vale a pena · 25 abaixo do piso')).toBeTruthy();
  });

  it('nenhuma palavra proibida', () => {
    const { container } = renderCard(base);
    expect(container.textContent).not.toMatch(/margem|lucro|candidato/i);
  });
});
