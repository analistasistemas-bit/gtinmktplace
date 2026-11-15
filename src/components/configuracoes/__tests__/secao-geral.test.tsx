import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mutate = vi.fn();
let podeEmpresa = true;
let ident: { nome: string; logo_claro_url: string | null; logo_escuro_url: string | null } | null = null;
vi.mock('@/hooks/useConfiguracoes', () => ({
  useMostrarLucroDashboard: () => ({ data: false }),
  useSalvarMostrarLucroDashboard: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('@/hooks/useOrgIdentidade', () => ({ useOrgIdentidade: () => ({ data: ident }) }));
vi.mock('@/hooks/useSalvarLogoOrg', () => ({
  useSalvarLogoOrg: () => ({ mutate, isPending: false, isSuccess: false, isError: false, variables: undefined }),
}));
vi.mock('../permissoes', () => ({ usePermissoesConfig: () => ({ podeEditarConfig: true, podeEditarEmpresa: podeEmpresa }) }));

import { SecaoGeral } from '../secao-geral';

const png = () => new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });
const svg = () => new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });

describe('SecaoGeral — identidade (logo da org)', () => {
  beforeEach(() => { mutate.mockReset(); podeEmpresa = true; ident = { nome: 'Avil', logo_claro_url: null, logo_escuro_url: 'https://x/e.png' }; });

  it('envia a logo para fundo claro', () => {
    render(<SecaoGeral />);
    fireEvent.change(screen.getByLabelText('Arquivo da logo para fundo claro'), { target: { files: [png()] } });
    expect(mutate).toHaveBeenCalledWith({ variante: 'claro', arquivo: expect.any(File) });
  });

  it('SVG: mostra o erro e não envia', () => {
    render(<SecaoGeral />);
    fireEvent.change(screen.getByLabelText('Arquivo da logo para fundo claro'), { target: { files: [svg()] } });
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Envie a logo em PNG, JPG ou WEBP.')).toBeTruthy();
  });

  it('remove só a versão que existe', () => {
    render(<SecaoGeral />);
    expect(screen.queryByRole('button', { name: 'Remover logo para fundo claro' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remover logo para fundo escuro' }));
    expect(mutate).toHaveBeenCalledWith({ variante: 'escuro', arquivo: null });
  });

  it('não-admin: envio e remoção desabilitados', () => {
    podeEmpresa = false;
    render(<SecaoGeral />);
    expect(screen.getByLabelText('Arquivo da logo para fundo claro')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remover logo para fundo escuro' })).toBeDisabled();
  });
});
