// ADR-0181 — "Cadastrar produto novo": Grade só é oferecida com tipo de produto habilitado.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EtapaItens } from '../etapa-itens';
import type { EstadoImportacao } from '../estado';

const item = { nItem: 1, cProd: 'REF 06', xProd: 'Short masculino - DIV - DIV', ncm: '62034900', cfop: '5102',
  gtin: null, uCom: 'PC', qCom: 35, vProd: 350, vFrete: 0, vSeg: 0, vDesc: 0, vOutro: 0, vIPI: 0, vST: 0, vFCPST: 0, orig: 0, rateio: {} };
const e = {
  nota: { emitenteNome: 'FORNECEDOR TESTE LTDA' }, itens: [item], xml: '', avisoTotal: null, divergenciaTotal: 0,
  aceitarDivergencia: false,
  decisoes: [{ nItem: 1, codigoPai: null, fator: 1, origemVinculo: null, candidatosGtin: [], distribuicao: [] }],
} as unknown as EstadoImportacao;

function renderEtapa(tiposProduto: string[] | undefined, carregandoTipos = false) {
  const onCadastrarNovo = vi.fn();
  render(<EtapaItens e={e} setE={() => {}} produtos={[]} onCadastrarNovo={onCadastrarNovo}
    tiposProduto={tiposProduto} carregandoTipos={carregandoTipos} />);
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
