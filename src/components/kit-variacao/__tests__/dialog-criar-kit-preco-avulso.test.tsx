// ADR-0200 (adendo 08/11): preço avulso das peças nas 3 etapas e o "Criar mesmo assim" quando o kit sai mais caro.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DialogCriarKitVariacao } from '../dialog-criar-kit-variacao';
import { calcularTarifaML, type Tarifa } from '@/lib/tarifa';
import { fetchPrecoAvulsoKit } from '@/lib/kit-variacao-edge';
import type { PrecoPeca } from '@/lib/kit-preco-avulso';

const v = (codigo: string, cor: string, custo: number) => ({
  codigo, cor, tamanho: 'M', estoque: 5, preco: 49.9, precoPublicacao: 49.9, excluidaDaPublicacao: false,
  custo, pesoGramas: 200, alturaCm: 3, larguraCm: 20, comprimentoCm: 30,
});
const familia = {
  data: {
    id: 'FAM', codigoPai: '0001', titulo: 'Short', origem: 'nacional', categoriaMlId: 'MLB1',
    variacoes: [v('P-M', 'Preto', 20), v('B-M', 'Branco', 25)],
  },
  isLoading: false, isError: false,
};
vi.mock('@/hooks/useFamilia', () => ({ useFamilia: () => familia }));
vi.mock('@/hooks/useModulosHabilitados', () => ({ useModulosHabilitados: () => ({ data: ['kit_variacao'] }) }));
const aliquotas = { data: { nacional: 8, importado: 16, confirmada: true }, isLoading: false, isError: false, isFetched: true };
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotas }));
vi.mock('@/lib/kit-variacao-edge', () => ({
  criarKitVariacaoEdge: vi.fn(async () => ({ ok: true, kit_id: 'K1' })),
  enviarFotoKit: vi.fn(async () => 'ORG/x.jpg'),
  gerarTextoKitEdge: vi.fn(async () => ({ ok: true, titulo: 'Kit 2 Shorts', descricao: 'Kit com 2 peças.', previa_id: 'PV1' })),
  fetchPrecoAvulsoKit: vi.fn(),
}));
vi.mock('@/lib/tarifa', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tarifa')>('@/lib/tarifa');
  return { ...actual, calcularTarifaML: vi.fn() };
});

function tarifa(preco: number): Tarifa {
  const imposto = Math.round(preco * 8) / 100;
  const tipo = (pct: number) => {
    const comissao = Math.round(preco * pct) / 100;
    return { comissao, percentual: pct, fixa: 0, imposto, recebe: Math.round((preco - comissao - 10 - imposto) * 100) / 100 };
  };
  return { classico: tipo(12), premium: tipo(17), frete: 10, proveniencia: 'official' };
}

// Preto em promoção (71,90 → 41,90, até 20/11); Branco sem promoção (59,90). Avulso: 131,80 normal · 101,80 em promoção.
const PRECOS = new Map<string, PrecoPeca>([
  ['P-M', { normal: 71.9, promocao: 41.9, fimPromocao: '2026-11-20T02:59:00Z' }],
  ['B-M', { normal: 59.9, promocao: null, fimPromocao: null }],
]);

function abrir() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DialogCriarKitVariacao familiaBaseId="FAM" open onOpenChange={() => {}} isAdmin={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function montar(user: ReturnType<typeof userEvent.setup>) {
  for (const c of ['Preto', 'Branco']) await user.click(screen.getByRole('checkbox', { name: `Cor ${c}` }));
  await user.type(screen.getByLabelText('Quantidade Preto e Branco M'), '1');
}
async function irParaConferir(user: ReturnType<typeof userEvent.setup>, preco: string) {
  await user.click(screen.getByRole('button', { name: 'Próximo' }));
  await user.clear(screen.getByLabelText('Preço do kit'));
  await user.type(screen.getByLabelText('Preço do kit'), preco);
  await screen.findByDisplayValue('Kit 2 Shorts');
  await user.upload(screen.getByLabelText('Foto Preto e Branco'), new File(['x'], 'pb.jpg', { type: 'image/jpeg' }));
  await user.click(screen.getByRole('button', { name: 'Próximo' }));
}

describe('DialogCriarKitVariacao: preço avulso das peças', () => {
  beforeEach(() => {
    vi.mocked(calcularTarifaML).mockImplementation(async (preco) => tarifa(preco));
    vi.mocked(fetchPrecoAvulsoKit).mockReset().mockResolvedValue(PRECOS);
  });

  it('etapa 1: soma das peças da combinação com cores de preços diferentes', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user);
    const celula = await screen.findByLabelText('Avulso Preto e Branco M');
    expect(celula).toHaveTextContent('R$ 131,80');
    expect(celula).toHaveTextContent('promo R$ 101,80');
  });

  it('etapa 2: referência da pior combinação e o desconto do kit sobre as duas somas', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.clear(screen.getByLabelText('Preço do kit'));
    await user.type(screen.getByLabelText('Preço do kit'), '78,90');
    expect(await screen.findByText(/Kit R\$ 78,90 · 40% abaixo do normal · 22% abaixo da promoção/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('etapa 3: kit ≥ soma em promoção exige "Criar mesmo assim", invalidado ao mudar o preço; avisa o fim da promoção', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await irParaConferir(user, '110');
    const bloco = await screen.findByRole('region', { name: 'Preço avulso das peças' });
    expect(within(bloco).getByText(/O kit sai mais caro que comprar as 2 peças avulsas na promoção atual \(R\$ 101,80\)\. O comprador pode preferir o avulso\./)).toBeInTheDocument();
    expect(within(bloco).getByText('A promoção da peça termina em 19/11. Depois disso a comparação muda.')).toBeInTheDocument();
    await screen.findByText('R$ 33,00'); // simulador pronto (110 − 13,20 − 10 − 8,80 − 45)
    const criarKit = screen.getByRole('button', { name: 'Criar kit' });
    expect(criarKit).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Criar mesmo assim' }));
    expect(criarKit).toBeEnabled();

    // Mudou o preço: a confirmação não vale mais.
    await user.type(screen.getByLabelText('Preço do kit'), '1');
    expect(screen.getByRole('checkbox', { name: 'Criar mesmo assim' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Criar kit' })).toBeDisabled();
  });

  it('rótulo da referência: com uma combinação só, "Avulso" sem "mais barato"', async () => {
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    // Etapa 2 sem lista e uma combinação só: "Avulso", sem "mais barato".
    expect(await screen.findByText(/^Avulso \(2 peças, Preto e Branco · M\)/)).toBeInTheDocument();
    expect(screen.queryByText(/mais barato/)).toBeNull();
  });

  it('etapa 3: promoções programadas das peças do kit, com valor, % abaixo do normal, tipo e janela', async () => {
    vi.mocked(fetchPrecoAvulsoKit).mockResolvedValue(new Map<string, PrecoPeca>([
      ['P-M', { ...PRECOS.get('P-M')!, futuras: [
        { tipo: 'LIGHTNING', preco: 39.9, inicio: '2026-11-15T15:00:00Z', fim: '2026-11-16T02:59:00Z' },
      ] }],
      ['B-M', { ...PRECOS.get('B-M')!, futuras: [
        { tipo: 'DEAL', preco: 44.9, inicio: '2026-11-20T03:00:00Z', fim: '2026-11-25T02:59:00Z' },
        { tipo: 'SMART', preco: null, inicio: '2026-11-26T03:00:00Z', fim: '2026-11-30T02:59:00Z' },
      ] }],
    ]));
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await irParaConferir(user, '80');
    const lista = await screen.findByRole('list', { name: 'Promoções programadas das peças' });
    // Relâmpago no mesmo dia (horário de Brasília): mostra a hora.
    expect(lista).toHaveTextContent('Preto · M: R$ 39,90 (45% abaixo de R$ 71,90) · Relâmpago · 15/11 12h às 23h59');
    expect(lista).toHaveTextContent('Branco · M: R$ 44,90 (25% abaixo de R$ 59,90) · Campanha · 20/11 a 24/11');
    expect(lista).toHaveTextContent('Branco · M: Co-participação · 26/11 a 29/11 · preço ainda não definido');
  });

  it('etapa 3: leitura das promoções falhou numa peça do kit avisa; resposta antiga sem "futuras" não quebra nem avisa', async () => {
    vi.mocked(fetchPrecoAvulsoKit).mockResolvedValue(new Map<string, PrecoPeca>([
      ['P-M', { ...PRECOS.get('P-M')!, futuras: [], futurasIndisponivel: true }],
      ['B-M', PRECOS.get('B-M')!], // edge antiga: sem os campos novos
    ]));
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await irParaConferir(user, '80');
    expect(await screen.findByText('Não foi possível ler as promoções programadas de Preto · M.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Promoções programadas das peças' })).toBeNull();
  });

  it('sem promoção: compara com a soma no preço normal', async () => {
    vi.mocked(fetchPrecoAvulsoKit).mockResolvedValue(new Map<string, PrecoPeca>([
      ['P-M', { normal: 71.9, promocao: null, fimPromocao: null }],
      ['B-M', { normal: 59.9, promocao: null, fimPromocao: null }],
    ]));
    const user = userEvent.setup();
    abrir();
    await montar(user);
    await irParaConferir(user, '131,80');
    expect(await screen.findByText(/O kit sai mais caro que comprar as 2 peças avulsas no preço atual \(R\$ 131,80\)/)).toBeInTheDocument();
    expect(screen.queryByText(/termina em/)).toBeNull();
  });

  it('leitura falhou: "preço avulso indisponível" e não bloqueia a criação', async () => {
    vi.mocked(fetchPrecoAvulsoKit).mockRejectedValue(new Error('rede'));
    const user = userEvent.setup();
    abrir();
    await montar(user);
    expect(await screen.findByLabelText('Avulso Preto e Branco M')).toHaveTextContent('indisponível');
    await irParaConferir(user, '500');
    expect(await screen.findByText(/Preço avulso indisponível: não foi possível comparar/)).toBeInTheDocument();
    await screen.findByText('R$ 345,00'); // 500 − 60 − 10 − 40 − 45
    expect(screen.queryByRole('checkbox', { name: 'Criar mesmo assim' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Criar kit' })).toBeEnabled();
  });
});
