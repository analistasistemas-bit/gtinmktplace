import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import * as XLSX from 'xlsx';

let orgAtual = 'org-1';
let suporte: object | null = null;
vi.mock('@/stores/support-store', () => ({ effectiveOrgId: () => orgAtual, useSupportStore: { getState: () => ({ context: suporte }) } }));
const listar = vi.fn(); const baixarXmls = vi.fn();
vi.mock('@/lib/pacote-contador/compras-fonte', () => ({
  listarNotasCompraMes: (...a: unknown[]) => listar(...a),
  baixarXmlsCompra: (...a: unknown[]) => baixarXmls(...a),
}));
const baixar = vi.fn();
vi.mock('@/lib/pacote-contador/baixar', async (orig) => ({ ...(await orig<object>()), baixarNotasMes: (...a: unknown[]) => baixar(...a) }));
const salvar = vi.fn();
vi.mock('@/lib/pacote-contador/montar', async (orig) => ({ ...(await orig<object>()), salvarArquivo: (...a: unknown[]) => salvar(...a) }));
const empresa = vi.fn();
vi.mock('@/lib/queries', () => ({ fetchEmpresaFiscal: (...a: unknown[]) => empresa(...a) }));
const xlsx = vi.fn();
vi.mock('@/lib/pacote-contador/relatorio-xlsx', async (orig) => {
  const m = await orig<typeof import('@/lib/pacote-contador/relatorio-xlsx')>();
  return { ...m, gerarRelatorioXlsx: (l: Parameters<typeof m.gerarRelatorioXlsx>[0], cab: Parameters<typeof m.gerarRelatorioXlsx>[1]) => { xlsx(cab); return m.gerarRelatorioXlsx(l, cab); } };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
import { toast } from 'sonner';
import { CardPacoteContador } from '../card-pacote-contador';
import { ErroPacote, ErroOrgMudou, ErroAuditoria, ErroRede } from '@/lib/pacote-contador/baixar';
import { row } from '@/lib/pacote-contador/__tests__/fixtures-compras';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-10-16T12:00:00-03:00'));   // mês padrão = 2026-09 em todos os testes
  orgAtual = 'org-1'; suporte = null;
  xlsx.mockReset(); empresa.mockReset(); empresa.mockResolvedValue(null);
  baixar.mockReset(); salvar.mockReset();
  listar.mockReset().mockResolvedValue([]); baixarXmls.mockReset().mockResolvedValue(new Map());
  vi.mocked(toast.error).mockReset(); vi.mocked(toast.success).mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('CardPacoteContador', () => {
  it('padrão = mês anterior; sem mês futuro; vazio gera pacote', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    empresa.mockResolvedValue({ razao_social: 'EMPRESA TESTE LTDA', cnpj: '11444777000161' });
    render(<CardPacoteContador />);
    const sel = screen.getByLabelText('Mês') as HTMLSelectElement;
    expect(sel.value).toBe('2026-09');
    expect([...sel.options].map((o) => o.value)).not.toContain('2026-11');
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(salvar).toHaveBeenCalledWith('pacote-2026-09.zip', expect.any(Uint8Array), 'application/zip'));
    expect(baixar).toHaveBeenCalledWith('2026-09', 'org-1', expect.any(AbortSignal));
    expect(xlsx).toHaveBeenCalledWith(expect.objectContaining({ org: 'EMPRESA TESTE LTDA', cnpj: '11444777000161' }));
    expect(toast.success).toHaveBeenCalledWith('Pacote de 2026-09 gerado.');
  });
  it('org trocada durante o download não salva', async () => {
    baixar.mockImplementationOnce(async () => { orgAtual = 'org-2'; return { tipo: 'vazio', contaMl: '99' }; });
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('desmontar ou trocar a org durante as pausas de leitura/montagem não salva', async () => {
    for (const acao of ['desmontar', 'trocar'] as const) {
      salvar.mockReset(); orgAtual = 'org-1';
      vi.useRealTimers();   // solta o Date do setSystemTime do beforeEach antes de falsear o setTimeout
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
      const { unmount } = render(<CardPacoteContador />);
      fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
      await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });   // download resolvido; parado na 1ª pausa
      if (acao === 'desmontar') unmount(); else orgAtual = 'org-2';
      await act(async () => { await vi.runAllTimersAsync(); });
      expect(salvar).not.toHaveBeenCalled();
      if (acao === 'trocar') { expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'); unmount(); }
      vi.useRealTimers();
    }
  });
  it('desmontar durante o download não salva', async () => {
    let soltar: (v: unknown) => void = () => {};
    baixar.mockImplementationOnce(() => new Promise((r) => { soltar = r; }));
    const { unmount } = render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    unmount();
    soltar({ tipo: 'vazio', contaMl: '99' });
    await new Promise((r) => setTimeout(r, 20));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('org trocada durante a busca da empresa fiscal não salva', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    empresa.mockImplementationOnce(async () => { orgAtual = 'org-2'; return null; });
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A organização mudou durante o download — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('falha ao buscar a empresa fiscal vira toast e não salva', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    empresa.mockRejectedValueOnce(new Error('falha de rede'));
    render(<CardPacoteContador />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('falha de rede'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('clique duplo instantâneo baixa uma vez só', async () => {
    baixar.mockResolvedValue({ tipo: 'vazio', contaMl: '99' });
    render(<CardPacoteContador />);
    const b = screen.getByRole('button', { name: 'Baixar pacote' });
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1));
    expect(baixar).toHaveBeenCalledTimes(1);
  });
  const clicar = () => fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote' }));
  it.each([
    ['429', new ErroPacote('limite', 429)], ['502', new ErroPacote('indisponível', 502)], ['rede', new ErroRede()],
  ])('vendas %s fora do suporte: pacote sai com compras e PARCIAL', async (_n, erro) => {
    baixar.mockRejectedValueOnce(erro);
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(salvar).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — vendas indisponíveis');
  });
  it.each([
    ['auditoria', new ErroAuditoria('auditoria falhou')], ['401', new ErroPacote('Sessão expirada — entre de novo.', 401)],
    ['403', new ErroPacote('sem acesso', 403)], ['org', new ErroOrgMudou()],
  ])('vendas %s aborta', async (_n, erro) => {
    baixar.mockRejectedValueOnce(erro);
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(erro.message));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('em suporte: 429 e zip de vendas ilegível abortam', async () => {
    suporte = { orgId: 'org-1', scope: 'full' };
    baixar.mockRejectedValueOnce(new ErroPacote('limite', 429));
    const { unmount } = render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('limite'));
    unmount();
    baixar.mockResolvedValueOnce({ tipo: 'zip', bytes: new Uint8Array([1, 2, 3]), contaMl: '99' });
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('O download veio incompleto — gere o pacote de novo.'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('falha ao listar compras aborta', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    listar.mockRejectedValueOnce(new Error('timeout'));
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('timeout'));
    expect(salvar).not.toHaveBeenCalled();
  });
  it('vendas indisponíveis + compra com falha: PARCIAL e selo nos 4 relatórios', async () => {
    baixar.mockRejectedValueOnce(new ErroPacote('limite', 429));
    listar.mockResolvedValueOnce([row({ n: 1 })]);
    baixarXmls.mockResolvedValueOnce(new Map([['id-1', { tipo: 'divergente' }]]));
    render(<CardPacoteContador />); clicar();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Pacote de 2026-09 gerado como PARCIAL — vendas indisponíveis; 1 compras com falha'));
    const z = unzipSync(salvar.mock.calls[0][1] as Uint8Array);
    for (const nome of ['relatorio-vendas.xlsx', 'relatorio-compras.xlsx']) {
      const wb = XLSX.read(z[nome], { type: 'array' });
      expect(String(XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0][0]))
        .toBe('PACOTE PARCIAL — vendas indisponíveis; 1 compras com falha');
    }
    for (const nome of ['relatorio-vendas.pdf', 'relatorio-compras.pdf']) expect(strFromU8(z[nome])).toContain('PACOTE PARCIAL');
  });
  it('StrictMode: depois do pacote o botão volta a "Baixar pacote"', async () => {
    baixar.mockResolvedValueOnce({ tipo: 'vazio', contaMl: '99' });
    render(<StrictMode><CardPacoteContador /></StrictMode>); clicar();
    await waitFor(() => expect(salvar).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar pacote' })).toBeEnabled());
  });
  it('rejeição tardia depois de desmontar não gera toast', async () => {
    let falhar: (e: unknown) => void = () => {};
    baixar.mockImplementationOnce(() => new Promise((_, rej) => { falhar = rej; }));
    const { unmount } = render(<CardPacoteContador />); clicar();
    unmount();
    falhar(new ErroPacote('limite', 429));
    await new Promise((r) => setTimeout(r, 20));
    expect(toast.error).not.toHaveBeenCalled();
    expect(salvar).not.toHaveBeenCalled();
  });
});
