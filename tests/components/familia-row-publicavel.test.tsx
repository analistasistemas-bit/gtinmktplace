import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FamiliaRow } from '@/components/familia-row';
import type { Familia, Variacao } from '@/lib/tipos-dominio';

function renderWithClient(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function cor(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000101', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 9, estoque: 5,
    gtin: null, fotoPath: 'u/l/101.jpeg', excluidaDaPublicacao: false, ...over,
  };
}
function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00000100', titulo: 'LINHA', descricao: 'd',
    operacao: 'CREATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'linha', categoriaMlId: 'MLB270273',
    precoMin: 9, precoMax: 9, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [cor({})], status: 'pronto', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0, ...over,
  };
}

describe('FamiliaRow — selo de publicável', () => {
  it('família incompleta mostra cadeado e desabilita o checkbox', () => {
    const f = fam({ categoriaMlId: null, tipoAviamento: 'outro' });
    renderWithClient(
      <FamiliaRow familia={f} selecionada={false} expandida={false} onSelecionar={() => {}} onExpandir={() => {}} />
    );
    expect(screen.getByRole('checkbox', { name: 'Selecionar família' })).toBeDisabled();
    expect(screen.getByText(/categoria/i)).toBeInTheDocument();
  });
  it('família publicável mantém o checkbox habilitado', () => {
    renderWithClient(
      <FamiliaRow familia={fam({})} selecionada={false} expandida={false} onSelecionar={() => {}} onExpandir={() => {}} />
    );
    expect(screen.getByRole('checkbox', { name: 'Selecionar família' })).not.toBeDisabled();
  });

  it('selo de pendência por cor vira botão que leva à variação com problema', () => {
    const onIr = vi.fn();
    const f = fam({ variacoes: [cor({ codigo: '00000777', cor: 'Cereja', fotoPath: undefined })] });
    renderWithClient(
      <FamiliaRow
        familia={f} selecionada={false} expandida={false}
        onSelecionar={() => {}} onExpandir={() => {}} onIrParaCritica={onIr}
      />
    );
    const btn = screen.getByRole('button', { name: /sem foto/i });
    fireEvent.click(btn);
    expect(onIr).toHaveBeenCalledWith('f1', '00000777');
  });

  it('sem onIrParaCritica, o selo de pendência não é um botão', () => {
    const f = fam({ variacoes: [cor({ codigo: '00000777', cor: 'Cereja', fotoPath: undefined })] });
    renderWithClient(
      <FamiliaRow familia={f} selecionada={false} expandida={false} onSelecionar={() => {}} onExpandir={() => {}} />
    );
    expect(screen.queryByRole('button', { name: /sem foto/i })).not.toBeInTheDocument();
  });
});
