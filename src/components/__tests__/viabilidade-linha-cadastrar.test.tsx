// T6 (plano 2026-08-08): botão "Cadastrar" / "Dar entrada" na linha da Viabilidade.
//
// Dois testes deste arquivo são TRAVAS financeiras, não cobertura:
//   - V-2     : sem mínimo digitado, `preco` NÃO pode cair para `item.mercado.menor`.
//   - V-2-bug : `preco` é o mínimo CRU, NUNCA `etiquetaParaMinimo` — `variacoes.preco` é o
//               líquido mínimo (ADR-0020) e `process-familia` aplica `grossUp` em cima dele.
// Por isso `@/lib/viabilidade` é mockado PARCIALMENTE: a trava compara com a
// `etiquetaParaMinimo` REAL. Um `vi.mock` cego transformaria o teste em teatro.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ViabilidadeLinha } from '../viabilidade-linha';
import { etiquetaParaMinimo, type ItemAnalisado } from '@/lib/viabilidade';
import type { CadastroInicial } from '@/components/estoque/dialog-cadastro-produto';

const analisarComDimensoesMock = vi.fn();

vi.mock('@/lib/viabilidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/viabilidade')>()),
  analisarComDimensoes: (...a: unknown[]) => analisarComDimensoesMock(...a),
}));

const modulosMock = vi.fn(() => ({ data: ['estoque'] as string[] }));
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => modulosMock(),
}));

// A alíquota vem do hook, não do item — 8% nacional é o que fecha a conta da trava V-2-bug.
vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));

// O diálogo real já é testado em T5 (dialog-cadastro-produto.test.tsx). Aqui só interessa
// COM QUE `inicial` ele é aberto e que o `onCadastrado` volta para a linha.
let inicialCapturado: CadastroInicial | undefined;
let onCadastradoCapturado: (() => void) | undefined;
vi.mock('@/components/estoque/dialog-cadastro-produto', () => ({
  DialogCadastroProduto: (props: {
    aberto: boolean; inicial?: CadastroInicial; onCadastrado?: () => void;
  }) => {
    inicialCapturado = props.inicial;
    onCadastradoCapturado = props.onCadastrado;
    // <tr>/<td>: a linha vive dentro de um <tbody> e um <div> solto ali dispara o aviso de
    // validateDOMNesting do React. O diálogo real só renderiza portal, então não tem esse problema.
    return props.aberto ? <tr><td data-testid="dialog-cadastro" /></tr> : null;
  },
}));

const ITEM_BASE: ItemAnalisado = {
  gtin: '7908615000244',
  nome: 'Cicaplast Baume B5+ La Roche-Posay 40ml',
  unidade: null,
  minimo: null,
  custo: null,
  origem: 'nacional',
  existeNoML: true,
  mercado: {
    menor: 99.9, maior: 129.9, vendedores: 1, freteGratis: 1, full: 0, ofertas: 1,
    observado: { menor: 99.9, maior: 129.9, vendedores: 1, ofertas: 1 },
  },
  classico: { saleFeeAmount: 13.99, percentual: 14, fixa: 0 },
  premium: { saleFeeAmount: 17.98, percentual: 18, fixa: 0 },
  frete: 10,
  dimensoesEncontradas: true,
  descricaoCatalogo: 'REPARAÇÃO INTENSIVA DE TRIPLA AÇÃO PARA PELE SENSIBILIZADA',
  jaCadastrado: false,
};

function MostraRota() {
  return <span data-testid="rota">{useLocation().pathname}</span>;
}

function renderLinha(item: Partial<ItemAnalisado> = {}, editavel = true) {
  return render(
    <MemoryRouter initialEntries={['/viabilidade']}>
      <MostraRota />
      <Routes>
        <Route
          path="*"
          element={(
            <table><tbody>
              <ViabilidadeLinha item={{ ...ITEM_BASE, ...item }} editavel={editavel} />
            </tbody></table>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const btnCadastrar = () => screen.queryByRole('button', { name: 'Cadastrar' });
const btnEntrada = () => screen.queryByRole('button', { name: 'Dar entrada' });

beforeEach(() => {
  inicialCapturado = undefined;
  onCadastradoCapturado = undefined;
  modulosMock.mockReturnValue({ data: ['estoque'] });
  analisarComDimensoesMock.mockReset();
});
afterEach(cleanup);

describe('ViabilidadeLinha — botão Cadastrar (T6)', () => {
  it('mostra "Cadastrar" quando existeNoML && editavel && módulo estoque && !jaCadastrado', () => {
    renderLinha();
    expect(btnCadastrar()).not.toBeNull();
    expect(btnEntrada()).toBeNull();
  });

  it('esconde o botão sem o módulo estoque', () => {
    modulosMock.mockReturnValue({ data: [] });
    renderLinha();
    expect(btnCadastrar()).toBeNull();
    expect(btnEntrada()).toBeNull();
  });

  it('esconde o botão quando editavel=false (modo planilha)', () => {
    renderLinha({}, false);
    expect(btnCadastrar()).toBeNull();
    expect(btnEntrada()).toBeNull();
  });

  it('mostra "Dar entrada" quando item.jaCadastrado e navega para /estoque', async () => {
    const user = userEvent.setup();
    renderLinha({ jaCadastrado: true });
    expect(btnCadastrar()).toBeNull();
    await user.click(btnEntrada()!);
    expect(screen.getByTestId('rota').textContent).toBe('/estoque');
    expect(screen.queryByTestId('dialog-cadastro')).toBeNull();
  });

  it('clique monta inicial com nomePai, descricaoPai, gtin e custo digitado', async () => {
    const user = userEvent.setup();
    renderLinha();
    await user.click(screen.getByText(ITEM_BASE.nome)); // expande a linha
    // '.' e não ',': o input da Viabilidade é <input type="number">, cujo `value` do DOM é
    // sempre com ponto. A vírgula do cadastro é responsabilidade de `numParaInput` — é
    // justamente essa conversão que a asserção abaixo cobre.
    await user.type(screen.getByLabelText('Custo'), '67.57');
    await user.click(btnCadastrar()!);
    expect(screen.getByTestId('dialog-cadastro')).toBeTruthy();
    expect(inicialCapturado?.nomePai).toBe(ITEM_BASE.nome);
    expect(inicialCapturado?.descricaoPai).toBe(ITEM_BASE.descricaoCatalogo);
    expect(inicialCapturado?.variacao?.gtin).toBe(ITEM_BASE.gtin);
    expect(inicialCapturado?.variacao?.custo).toBe('67,57');
  });

  // TRAVA V-2: `item.mercado.menor` é o preço do CONCORRENTE. Cair para ele encheria um campo
  // financeiro com cara de valor calculado.
  it('preco vazio sem mínimo digitado — NUNCA usa o menor do mercado', async () => {
    const user = userEvent.setup();
    renderLinha();
    expect(btnCadastrar()).not.toBeNull();
    await user.click(btnCadastrar()!);
    expect(screen.getByTestId('dialog-cadastro')).toBeTruthy();
    expect(inicialCapturado?.variacao?.preco ?? '').toBe('');
    expect(inicialCapturado?.variacao?.preco).not.toBe('99,9');
  });

  // TRAVA V-2-bug: `variacoes.preco` é o líquido mínimo (ADR-0020) e `process-familia` aplica
  // `grossUp` em cima dele. `etiquetaParaMinimo` JÁ é gross-up — gravá-la publicaria preço
  // regrossado (mínimo R$ 70 → anúncio ~R$ 152). Os números aqui separam as duas pontas:
  // comissão 14% + alíquota 8% + frete 10 ⇒ etiqueta ≈ 102,60 para um mínimo de 70.
  it('preco = mínimo CRU, e NÃO etiquetaParaMinimo (trava contra gross-up duplo, V-2-bug)', async () => {
    const user = userEvent.setup();
    renderLinha();
    await user.click(screen.getByText(ITEM_BASE.nome));
    await user.type(screen.getByLabelText('Seu mínimo'), '70');
    await user.click(btnCadastrar()!);
    const etiqueta = String(etiquetaParaMinimo(70, 14, 8, 10)).replace('.', ',');
    expect(etiqueta).toBe('102,6'); // pina a aritmética: se mudar, o teste abaixo perde o sentido
    expect(inicialCapturado?.variacao?.preco).toBe('70');
    expect(inicialCapturado?.variacao?.preco).not.toBe(etiqueta);
  });

  it('dimensões digitadas no FormDimensoes entram no inicial', async () => {
    const user = userEvent.setup();
    analisarComDimensoesMock.mockResolvedValue({ ...ITEM_BASE, dimensoesEncontradas: true, frete: 12 });
    renderLinha({ dimensoesEncontradas: false });
    await user.click(screen.getByText(ITEM_BASE.nome));
    await user.type(screen.getByLabelText('Altura (cm)'), '6');
    await user.type(screen.getByLabelText('Largura (cm)'), '11');
    await user.type(screen.getByLabelText('Compr. (cm)'), '16');
    await user.type(screen.getByLabelText('Peso (g)'), '300');
    await user.click(screen.getByRole('button', { name: 'Recalcular frete' }));
    // O item recalculado volta com dimensoesEncontradas: true → o FormDimensoes some.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Recalcular frete' })).toBeNull());
    await user.click(btnCadastrar()!);
    expect(inicialCapturado?.variacao?.pesoGramas).toBe('300');
    expect(inicialCapturado?.variacao?.alturaCm).toBe('6');
    expect(inicialCapturado?.variacao?.larguraCm).toBe('11');
    expect(inicialCapturado?.variacao?.comprimentoCm).toBe('16');
  });

  it('após onCadastrado, o botão vira "Dar entrada"', async () => {
    const user = userEvent.setup();
    renderLinha();
    await user.click(btnCadastrar()!);
    expect(onCadastradoCapturado).toBeTypeOf('function');
    act(() => { onCadastradoCapturado!(); });
    expect(btnCadastrar()).toBeNull();
    expect(btnEntrada()).not.toBeNull();
  });

  it('clicar no botão não expande/colapsa a linha', async () => {
    const user = userEvent.setup();
    renderLinha();
    expect(screen.queryByLabelText('Seu mínimo')).toBeNull();
    expect(btnCadastrar()).not.toBeNull();
    await user.click(btnCadastrar()!);
    expect(screen.getByTestId('dialog-cadastro')).toBeTruthy();
    // O detalhe da linha continua fechado: o clique não subiu para o onClick do <tr>.
    expect(screen.queryByLabelText('Seu mínimo')).toBeNull();
  });
});
