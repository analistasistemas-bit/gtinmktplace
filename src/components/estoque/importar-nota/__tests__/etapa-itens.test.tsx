// ADR-0181 — "Cadastrar produto novo": Grade só é oferecida com tipo de produto habilitado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EtapaItens } from '../etapa-itens';
import type { EstadoImportacao } from '../estado';
import type { ProdutoEstoqueResumo } from '@/lib/produtos-saldo';

const item = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, rateio: {} };
const e = {
  nota: { emitenteNome: 'FORNECEDOR TESTE LTDA' }, itens: [item], xml: '', avisoTotal: null, divergenciaTotal: 0,
  aceitarDivergencia: false,
  decisoes: [{ nItem: 1, codigoPai: null, fator: 1, origemVinculo: null, candidatosGtin: [], candidatosNota: [], distribuicao: [] }],
} as unknown as EstadoImportacao;

const Wrap = ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

function renderEtapa(tiposProduto: string[] | undefined, carregandoTipos = false) {
  const onCadastrarNovo = vi.fn();
  render(<Wrap><EtapaItens e={e} setE={() => {}} produtos={[]} onCadastrarNovo={onCadastrarNovo}
    tiposProduto={tiposProduto} carregandoTipos={carregandoTipos} /></Wrap>);
  return onCadastrarNovo;
}

afterEach(cleanup);

describe('EtapaItens — cadastrar produto novo', () => {
  it('com tipo habilitado pergunta Grade/Simples', async () => {
    const user = userEvent.setup();
    const onCadastrarNovo = renderEtapa(['roupa']);
    await user.click(screen.getByRole('button', { name: 'Cadastrar produto novo' }));
    expect(screen.getByText('Este produto tem tamanho/cor?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Grade' }));
    expect(onCadastrarNovo).toHaveBeenCalledWith(1, 'grade');
  });

  it('sem tipo habilitado abre direto o simples', async () => {
    const user = userEvent.setup();
    const onCadastrarNovo = renderEtapa([]);
    await user.click(screen.getByRole('button', { name: 'Cadastrar produto novo' }));
    expect(screen.queryByText('Este produto tem tamanho/cor?')).not.toBeInTheDocument();
    expect(onCadastrarNovo).toHaveBeenCalledWith(1, 'simples');
  });

  it('tipos ainda carregando: botão desabilitado', () => {
    renderEtapa(undefined, true);
    expect(screen.getByRole('button', { name: 'Cadastrar produto novo' })).toBeDisabled();
  });
});

const prod = (codigoPai: string, nomePai: string, qtdSkus = 1) =>
  ({ codigoPai, nomePai, qtdSkus, capaStoragePath: null, capaMlPictureId: null }) as unknown as ProdutoEstoqueResumo;
const SHORT = prod('00000010', 'Short Linho Mauricinho Masculino', 32);
const OUTRO_A = prod('00000020', 'Camiseta Azul');
const OUTRO_B = prod('00000030', 'Camiseta Verde');
const item2 = { ...item, nItem: 2, xProd: 'Conjunto infantil - DIV - DIV' };
const dec = (o: object) => ({ nItem: 1, codigoPai: null, fator: 1, origemVinculo: null, candidatosGtin: [],
  candidatosNota: [], distribuicao: [], ...o });
const estado = (decisoes: object[], itens = [item]) => ({ ...e, itens, decisoes }) as unknown as EstadoImportacao;

function montar(est: EstadoImportacao, extra: Partial<React.ComponentProps<typeof EtapaItens>> = {}) {
  const setE = vi.fn();
  render(<Wrap><EtapaItens e={est} setE={setE} produtos={[SHORT, OUTRO_A, OUTRO_B]}
    onCadastrarNovo={vi.fn()} tiposProduto={[]} {...extra} /></Wrap>);
  return setE;
}

describe('EtapaItens — layout em cartões', () => {
  it('item vinculado: nome, código, SKUs, selo e progresso; sem busca', () => {
    montar(estado([dec({ codigoPai: '00000010', origemVinculo: 'vinculo' })]));
    expect(screen.getByText('Short Linho Mauricinho Masculino')).toBeInTheDocument();
    expect(screen.getByText(/00000010/)).toBeInTheDocument();
    expect(screen.getByText(/32 SKUs/)).toBeInTheDocument();
    expect(screen.getByText('Vinculado')).toBeInTheDocument();
    expect(screen.getByText('Distribuídas: 0 de 35 · faltam 35')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('topo mostra itens prontos', () => {
    montar(estado([dec({ codigoPai: '00000010', origemVinculo: 'vinculo' }), dec({ nItem: 2 })], [item, item2]));
    expect(screen.getByText('1 de 2 itens prontos')).toBeInTheDocument();
  });

  it('sem produto: selo, dois botões, nada listado; Escolher existente foca a busca', async () => {
    const user = userEvent.setup();
    montar(estado([dec({})]));
    expect(screen.getByText('Sem produto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar produto novo' })).toBeInTheDocument();
    expect(screen.queryByText('Camiseta Azul')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Escolher existente…' }));
    expect(screen.getByText('Digite para buscar')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('digitar busca em todos os produtos mesmo com candidatosGtin', async () => {
    const user = userEvent.setup();
    montar(estado([dec({ candidatosGtin: ['00000020', '00000030'] })]));
    await user.click(screen.getByRole('button', { name: 'Escolher existente…' }));
    expect(screen.getByText('Camiseta Azul')).toBeInTheDocument();
    expect(screen.queryByText('Short Linho Mauricinho Masculino')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'short');
    expect(screen.getByText('Short Linho Mauricinho Masculino')).toBeInTheDocument();
    expect(screen.queryByText('Camiseta Azul')).not.toBeInTheDocument();
  });

  it('Trocar e Cancelar preserva o produto; Trocar mantém Cadastrar produto novo', async () => {
    const user = userEvent.setup();
    const setE = montar(estado([dec({ codigoPai: '00000010', origemVinculo: 'vinculo' })]));
    await user.click(screen.getByRole('button', { name: 'Trocar' }));
    expect(screen.getByRole('button', { name: 'Cadastrar produto novo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Short Linho Mauricinho Masculino')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(setE).not.toHaveBeenCalled();
  });

  it('erroProdutos mostra erro; carregandoProdutos mostra carregando', async () => {
    const user = userEvent.setup();
    montar(estado([dec({})]), { erroProdutos: true });
    await user.click(screen.getByRole('button', { name: 'Escolher existente…' }));
    expect(screen.getByText(/Não foi possível carregar os produtos/)).toBeInTheDocument();
    expect(screen.queryByText('Digite para buscar')).not.toBeInTheDocument();
    cleanup();
    montar(estado([dec({})]), { carregandoProdutos: true });
    await user.click(screen.getByRole('button', { name: 'Escolher existente…' }));
    expect(screen.getByText('Carregando produtos…')).toBeInTheDocument();
  });

  it('candidatosNota de 2: selo de ambiguidade e os 2 listados sem digitar', () => {
    montar(estado([dec({ candidatosNota: ['00000020', '00000030'] })]));
    expect(screen.getByText('Cadastrado mais de uma vez — escolha')).toBeInTheDocument();
    expect(screen.getByText('Camiseta Azul')).toBeInTheDocument();
    expect(screen.getByText('Camiseta Verde')).toBeInTheDocument();
    expect(screen.queryByText('Short Linho Mauricinho Masculino')).not.toBeInTheDocument();
  });

  it('conferirFalhou: aviso e Tentar novamente', async () => {
    const user = userEvent.setup();
    const onTentarNovamente = vi.fn();
    montar(estado([dec({})]), { conferirFalhou: true, onTentarNovamente });
    expect(screen.getByText('Não foi possível conferir produtos já cadastrados desta nota')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(onTentarNovamente).toHaveBeenCalled();
  });
});
