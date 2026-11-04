import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { PreviewOperacao } from '../preview-operacao';
import { useCriarOperacao, usePodeExecutarOperacao } from '@/hooks/useOperacoes';
import type { CorProjetada, ItemPromocao } from '@/lib/promocoes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const simularAsync = vi.fn();
vi.mock('@/hooks/useOperacoes', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperacoes')>('@/hooks/useOperacoes');
  return {
    ...actual, useCriarOperacao: vi.fn(), usePodeExecutarOperacao: vi.fn(),
    useSimularPrecos: () => ({ mutateAsync: simularAsync, isPending: false }),
  };
});

function cor(over: Partial<CorProjetada> = {}): CorProjetada {
  return {
    variation_id: 1, cor: 'Azul', sku: null, custo: 5, piso: 10, origem: 'nacional',
    comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null,
    ...over,
  };
}
function item(over: Partial<ItemPromocao> = {}): ItemPromocao {
  return {
    ml_item_id: 'MLB1', status: 'candidate',
    preco_original: 100, preco_promo: 80, preco_min: 7, preco_max: 18.99,
    preco_sugerido: 10, preco_avaliado: 10, ml_pct: null, estoque_min: null,
    titulo: 'Produto', thumbnail: null, permalink: null,
    projecao: [cor()], pior_semaforo: 'verde',
    ...over,
  };
}

const mutateAsync = vi.fn();

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ operacao_id: 'op1' });
  vi.mocked(useCriarOperacao).mockReturnValue({ mutateAsync, isPending: false } as never);
  vi.mocked(usePodeExecutarOperacao).mockReturnValue(true);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function renderPreview(props: Partial<Parameters<typeof PreviewOperacao>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PreviewOperacao
        acao="aderir" tipo="DEAL" promocaoId="P1" promocaoNome="Campanha X"
        itens={[]} aberto onClose={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('PreviewOperacao', () => {
  it('DEAL aderir marca só o verde por padrão', () => {
    const verde = item({ ml_item_id: 'V', preco_sugerido: 85, preco_min: 70, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, preco_min: 70, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    renderPreview({ itens: [verde, vermelho] });
    expect(screen.getByLabelText('Selecionar V')).toBeChecked();
    expect(screen.getByLabelText('Selecionar R')).not.toBeChecked();
  });

  it('digitar preço fora da faixa desabilita Executar', async () => {
    const user = userEvent.setup();
    const verde = item({ ml_item_id: 'V', preco_sugerido: 10, preco_min: 7, preco_max: 18.99, projecao: [cor({ custo: 5, piso: 8 })] });
    renderPreview({ itens: [verde] });

    expect(screen.getByRole('button', { name: 'Executar' })).not.toBeDisabled();

    const input = screen.getByLabelText('Preço de V');
    await user.clear(input);
    await user.type(input, '19,50');

    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
  });

  describe('LIGHTNING', () => {
    const rel = (over: Partial<ItemPromocao> = {}) => item({
      ml_item_id: 'L', preco_sugerido: 30, preco_min: 10, preco_max: 50, estoque_min: 5, projecao: [cor({ custo: 5, piso: 8 })], ...over,
    });

    it('preço editável', () => {
      renderPreview({ tipo: 'LIGHTNING', itens: [rel()] });
      expect(screen.getByLabelText('Preço de L')).toHaveValue('30,00');
    });

    it("18,99 bloqueia envio e mostra 'Mínimo R$ 19,00 (frete grátis)'", async () => {
      const user = userEvent.setup();
      renderPreview({ tipo: 'LIGHTNING', itens: [rel()] });
      expect(screen.getByText('Mínimo R$ 19,00 (frete grátis)')).toBeInTheDocument();
      const input = screen.getByLabelText('Preço de L');
      await user.clear(input);
      await user.type(input, '18,99');
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    });

    it('faixa incompleta bloqueia e avisa', () => {
      renderPreview({ tipo: 'LIGHTNING', itens: [rel({ preco_min: 40, preco_max: null, preco_sugerido: 30 })] });
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
      expect(screen.getByText('O ML não informou a faixa de preço deste anúncio')).toBeInTheDocument();
    });

    it('envia o preço editado, não o sugerido', async () => {
      const user = userEvent.setup();
      renderPreview({ tipo: 'LIGHTNING', itens: [rel()] });
      const input = screen.getByLabelText('Preço de L');
      await user.clear(input);
      await user.type(input, '42,50');
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ itens: [{ ml_item_id: 'L', preco: 42.5, confirmado_risco: false }] }));
    });

    it('fora da faixa bloqueia', async () => {
      const user = userEvent.setup();
      renderPreview({ tipo: 'LIGHTNING', itens: [rel()] });
      const input = screen.getByLabelText('Preço de L');
      await user.clear(input);
      await user.type(input, '60');
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    });

    it("mostra 'Reserva 5 un.' e envia o preço", async () => {
      const user = userEvent.setup();
      renderPreview({ tipo: 'LIGHTNING', itens: [rel()] });
      expect(screen.getByText('Reserva 5 un.')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ itens: [{ ml_item_id: 'L', preco: 30, confirmado_risco: false }] }));
    });
  });

  it('item vermelho marcado exige o checkbox de risco para habilitar Executar', async () => {
    const user = userEvent.setup();
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, preco_min: 1, preco_max: 90, projecao: [cor({ custo: 5, piso: 10 })] });
    renderPreview({ itens: [vermelho] });

    await user.click(screen.getByLabelText('Selecionar R'));
    expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();

    await user.click(screen.getByLabelText('Aderir mesmo assim'));
    expect(screen.getByRole('button', { name: 'Executar' })).not.toBeDisabled();
  });

  it('não admin não vê o botão Executar', () => {
    vi.mocked(usePodeExecutarOperacao).mockReturnValue(false);
    renderPreview({ itens: [item()] });
    expect(screen.queryByRole('button', { name: 'Executar' })).not.toBeInTheDocument();
    expect(screen.getByText('Só administradores executam operações em massa.')).toBeInTheDocument();
  });

  describe.each(['SMART_LIGHTNING', 'PRICE_MATCHING'] as const)('%s (oferta fixa)', (tipo) => {
    const fixo = (over: Partial<ItemPromocao> = {}) => item({
      ml_item_id: 'F', preco_promo: 64, preco_sugerido: null, preco_min: null, preco_max: null, estoque_min: 5, projecao: [cor({ custo: 5, piso: 8 })], ...over,
    });

    it('preço travado, mas enviado no pedido', async () => {
      const user = userEvent.setup();
      renderPreview({ tipo, itens: [fixo()] });
      expect(screen.queryByLabelText('Preço de F')).not.toBeInTheDocument();
      expect(screen.getByText('R$ 64,00')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ itens: [{ ml_item_id: 'F', preco: 64, confirmado_risco: false }] }));
    });

    it('18,99 bloqueia aderir com a mensagem do piso', () => {
      renderPreview({ tipo, itens: [fixo({ preco_promo: 18.99 })] });
      expect(screen.getByText('Mínimo R$ 19,00 (frete grátis)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    });

    it('preço nulo bloqueia aderir', () => {
      renderPreview({ tipo, itens: [fixo({ preco_promo: null })] });
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    });

    it('sair com preço < 19 continua livre', () => {
      renderPreview({ tipo, acao: 'sair', itens: [fixo({ status: 'started', preco_promo: 18.99 })] });
      expect(screen.queryByText('Mínimo R$ 19,00 (frete grátis)')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Executar' })).not.toBeDisabled();
    });

    it('aviso de entrada imediata só no PRICE_MATCHING', () => {
      renderPreview({ tipo, itens: [fixo()] });
      const aviso = screen.queryByText('Entra no ar assim que você confirmar.');
      if (tipo === 'PRICE_MATCHING') expect(aviso).toBeInTheDocument(); else expect(aviso).not.toBeInTheDocument();
    });

    it('Reserva N un. só no SMART_LIGHTNING', () => {
      renderPreview({ tipo, itens: [fixo()] });
      const reserva = screen.queryByText('Reserva 5 un.');
      if (tipo === 'SMART_LIGHTNING') expect(reserva).toBeInTheDocument(); else expect(reserva).not.toBeInTheDocument();
    });
  });

  it('Executar chama a mutation com {acao, promocao_id, itens}', async () => {
    const user = userEvent.setup();
    const verde = item({ ml_item_id: 'V', preco_sugerido: 10, preco_min: 7, preco_max: 18.99, projecao: [cor({ custo: 5, piso: 8 })] });
    renderPreview({ itens: [verde], promocaoId: 'P9' });

    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(mutateAsync).toHaveBeenCalledWith({
      acao: 'aderir', promocao_id: 'P9', origem_id: null,
      itens: [{ ml_item_id: 'V', preco: 10, confirmado_risco: false }],
    });
    expect(toast.success).toHaveBeenCalledWith('Operação iniciada: 1 anúncios');
  });

  it('achado 2 (revisão): sucesso chama onSucesso (quem limpa a seleção), antes de fechar', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSucesso = vi.fn();
    const verde = item({ ml_item_id: 'V', preco_sugerido: 10, preco_min: 7, preco_max: 18.99, projecao: [cor({ custo: 5, piso: 8 })] });
    renderPreview({ itens: [verde], onClose, onSucesso });

    await user.click(screen.getByRole('button', { name: 'Executar' }));

    expect(onSucesso).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('achado 2 (revisão): fechar sem executar (X do sheet) não chama onSucesso', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSucesso = vi.fn();
    renderPreview({ itens: [item()], onClose, onSucesso });

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSucesso).not.toHaveBeenCalled();
  });

  it('naoRevertiveis: linha nasce desmarcada, com o motivo, e o checkbox fica desabilitado (Reverter)', () => {
    const linha = item({ ml_item_id: 'V' });
    renderPreview({ itens: [linha], naoRevertiveis: new Map([['V', 'Não revertível: o anúncio não está mais convidado/participando']]) });

    expect(screen.getByLabelText('Selecionar V')).not.toBeChecked();
    expect(screen.getByLabelText('Selecionar V')).toBeDisabled();
    expect(screen.getByText('Não revertível: o anúncio não está mais convidado/participando')).toBeInTheDocument();
  });

  // Emenda 2026-11-03: alterar o preço de quem já participa (DEAL), em massa.
  describe('alterar_preco', () => {
    const participante = (id: string) => item({
      ml_item_id: id, status: 'started', preco_original: 73.25, preco_promo: 49.9, preco_avaliado: 49.9,
      preco_min: null, preco_max: null, preco_sugerido: null,
      projecao: [cor({ comissao_pct: 14, frete: 8.25, aliquota_pct: 4, custo: 18.5, piso: 28.5, liquido: 32.67 })],
    });

    it('abre com o preço vigente, todos marcados; Aplicar a todos troca o preço e o envio leva alterar_preco', async () => {
      const user = userEvent.setup();
      simularAsync.mockReset().mockImplementation(async ({ itens }) => itens.map((i: { ml_item_id: string; preco: number }) => ({
        ml_item_id: i.ml_item_id, status: 'simulado', preco: i.preco, pior_semaforo: 'verde',
        projecao: [cor({ comissao_pct: 14, frete: 8.25, aliquota_pct: 4, custo: 18.5, piso: 28.5, liquido: 29, semaforo: 'verde' })],
      })));
      renderPreview({ acao: 'alterar_preco', itens: [participante('A'), participante('B')] });
      expect(screen.getByText('Alterar preço em Campanha X')).toBeInTheDocument();
      expect(screen.getByLabelText('Preço de A')).toHaveValue('49,90');
      expect(screen.getByLabelText('Selecionar A')).toBeChecked();
      await user.type(screen.getByLabelText('Desconto em % para todos'), '40');
      await user.click(screen.getByRole('button', { name: 'Aplicar a todos' }));
      expect(screen.getByLabelText('Preço de A')).toHaveValue('43,95'); // 73,25 × 0,60
      await screen.findAllByText(/R\$ 10,50/); // lucro 29 − 18,50 no preço novo, do servidor
      await user.click(screen.getByRole('button', { name: 'Executar' }));
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        acao: 'alterar_preco', promocao_id: 'P1',
        itens: [expect.objectContaining({ ml_item_id: 'A', preco: 43.95 }), expect.objectContaining({ ml_item_id: 'B', preco: 43.95 })],
      }));
    });

    it('preço igual ou acima do original bloqueia o envio', async () => {
      const user = userEvent.setup();
      simularAsync.mockReset().mockResolvedValue([]);
      renderPreview({ acao: 'alterar_preco', itens: [participante('A')] });
      const campo = screen.getByLabelText('Preço de A');
      await user.clear(campo);
      await user.type(campo, '73,25');
      expect(screen.getByText(/Precisa ser menor que o preço original/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Executar' })).toBeDisabled();
    });

    it('Reverter: abre com o preço anterior e calcula o lucro dele no servidor ao abrir', async () => {
      simularAsync.mockReset().mockResolvedValue([{ ml_item_id: 'A', status: 'simulado', preco: 49.9, pior_semaforo: 'verde',
        projecao: [cor({ comissao_pct: 14, frete: 8.25, aliquota_pct: 4, custo: 18.5, piso: 28.5, liquido: 32.67 })] }]);
      renderPreview({ acao: 'alterar_preco', origemId: 'OP1', itens: [{ ...participante('A'), preco_promo: 43.9, preco_avaliado: 43.9 }], simulados: new Map([['A', 49.9]]) });
      expect(screen.getByText('Reverter preço em Campanha X')).toBeInTheDocument();
      expect(screen.getByLabelText('Preço de A')).toHaveValue('49,90');
      expect(simularAsync).toHaveBeenCalledWith({ promocao_id: 'P1', itens: [{ ml_item_id: 'A', preco: 49.9 }] });
      expect(await screen.findByText(/R\$ 14,17/)).toBeInTheDocument();
    });
  });

  // Pedido do Diego (03/11): mesmo desconto/preço para todas as variações marcadas, com lucro do servidor.
  describe('aplicar a todos', () => {
    const tarifa = { comissao_pct: 14, comissao_fixa: 0, frete: 8.25, aliquota_pct: 4 };
    const variacao = (id: string) => item({
      ml_item_id: id, preco_original: 73.25, preco_min: 14.65, preco_max: 71.05, preco_sugerido: 63.72, preco_avaliado: 63.72,
      projecao: [cor({ ...tarifa, custo: 18.5, piso: 28.5, liquido: 44.3 })],
    });

    it('desconto % vira o preço de cada linha (marcada ou não), e o lucro vem do servidor naquele preço', async () => {
      const user = userEvent.setup();
      simularAsync.mockReset().mockImplementation(async ({ itens }) => itens.map((i: { ml_item_id: string; preco: number }) => ({
        ml_item_id: i.ml_item_id, status: 'simulado', preco: i.preco, pior_semaforo: 'verde',
        projecao: [cor({ ...tarifa, custo: 18.5, piso: 28.5, liquido: 39.92 })],
      })));
      renderPreview({ itens: [variacao('A'), variacao('B')] });
      // abre com o lucro do preço sugerido (projeção do sync = mesmo preço)
      expect(screen.getAllByText(/R\$ 25,80/)).toHaveLength(2); // 44,30 − 18,50

      await user.type(screen.getByLabelText('Desconto em % para todos'), '20');
      await user.click(screen.getByRole('button', { name: 'Aplicar a todos' }));

      expect(simularAsync).toHaveBeenCalledWith({ promocao_id: 'P1', itens: [{ ml_item_id: 'A', preco: 58.6 }, { ml_item_id: 'B', preco: 58.6 }] });
      expect(screen.getByLabelText('Preço de A')).toHaveValue('58,60');
      expect(screen.getByLabelText('Preço de B')).toHaveValue('58,60');
      expect(await screen.findAllByText(/R\$ 21,42/)).toHaveLength(2); // lucro 39,92 − 18,50
    });

    it('achado Codex: voltar ao preço já calculado restaura o semáforo do servidor (não a estimativa local)', async () => {
      const user = userEvent.setup();
      simularAsync.mockReset().mockImplementation(async ({ itens }) => itens.map((i: { ml_item_id: string; preco: number }) => ({
        ml_item_id: i.ml_item_id, status: 'simulado', preco: i.preco, pior_semaforo: 'vermelho',
        projecao: [cor({ ...tarifa, custo: 18.5, piso: 28.5, liquido: 10, semaforo: 'vermelho' })],
      })));
      renderPreview({ itens: [variacao('A')] });
      await user.type(screen.getByLabelText('Desconto em % para todos'), '20');
      await user.click(screen.getByRole('button', { name: 'Aplicar a todos' }));
      expect(await screen.findByText('Prejuízo')).toBeInTheDocument();
      const campo = screen.getByLabelText('Preço de A');
      await user.clear(campo);
      await user.type(campo, '60');
      await user.clear(campo);
      await user.type(campo, '58,60');
      expect(screen.getByText('Prejuízo')).toBeInTheDocument();
    });

    it('"Menor preço viável" mostra o valor no botão', () => {
      renderPreview({ itens: [item({ ...variacao('A'), projecao: [cor({ ...tarifa, custo: 18.5, piso: 28.5, liquido: 44.3, ate_quanto: 41.45 })] })] });
      expect(screen.getByRole('button', { name: /Menor preço viável: R\$\s41,45/ })).toBeInTheDocument();
    });

    it('editar o preço à mão esconde o lucro antigo e oferece recalcular', async () => {
      const user = userEvent.setup();
      renderPreview({ itens: [variacao('A')] });
      const campo = screen.getByLabelText('Preço de A');
      await user.clear(campo);
      await user.type(campo, '60');
      expect(screen.queryByText(/R\$ 25,80/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Recalcular lucro' })).toBeInTheDocument();
    });
  });

  // ADR-0194 D-9: adesão vinda de sugestão leva a marcação; adesão comum não manda o campo.
  it('repassa a marcação de origem só quando vem de sugestão', async () => {
    const user = userEvent.setup();
    const sugestao = { faixa: 'quase_vendendo' as const, oportunidade: 12.5, chave: 'p:1' };
    const { unmount } = renderPreview({ tipo: 'SMART', itens: [item()], sugestao });
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({ sugestao }));
    unmount();
    renderPreview({ tipo: 'SMART', itens: [item()] });
    await user.click(screen.getByRole('button', { name: 'Executar' }));
    expect(mutateAsync.mock.calls.at(-1)![0]).not.toHaveProperty('sugestao');
  });
});
