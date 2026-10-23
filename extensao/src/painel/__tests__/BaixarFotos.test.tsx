// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BaixarFotos } from '../BaixarFotos';

const jpeg = () => { const b = new Uint8Array(256); b.set([0xff, 0xd8, 0xff]); b.set([0xff, 0xd9], 254); return b; };
const ids = ['100001-MLA115537568801_082026', '100002-MLA115537568802_082026', '100003-MLA115537568803_082026'];
const salvos: string[] = [];

beforeEach(() => {
  salvos.length = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:zip'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { salvos.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('baixa as fotos do anúncio do clique, pede o download do ZIP e lista a que falhou', async () => {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => (u.includes(ids[1]) ? new Response('', { status: 404 }) : new Response(jpeg()))));
  render(<BaixarFotos mlItemId="MLB5321956667" ids={ids} clips={2} />);
  screen.getByText(/Clips não entram/);
  fireEvent.click(screen.getByRole('button', { name: /Baixar fotos \(ZIP\)/ }));
  await screen.findByText('Download solicitado: 2 fotos na resolução original.');
  screen.getByText('A foto 2 não veio.');
  expect(salvos).toEqual(['PubliAI-MLB5321956667-fotos.zip']);
  fireEvent.click(screen.getByRole('button', { name: 'Salvar o ZIP de novo' }));
  expect(salvos).toHaveLength(2);
});

it('nenhuma foto: diz o que fazer e "Tentar de novo" baixa direto', async () => {
  const buscar = vi.fn(async () => new Response('', { status: 500 }));
  vi.stubGlobal('fetch', buscar);
  render(<BaixarFotos mlItemId="MLB1" ids={ids.slice(0, 1)} clips={0} />);
  expect(screen.queryByText(/Clips não entram/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Baixar fotos/ }));
  await screen.findByText(/Nenhuma foto pôde ser baixada/);
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
  await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
  expect(salvos).toEqual([]);
});

it('foco acompanha a troca de estado: Baixar → Cancelar → Salvar o ZIP de novo', async () => {
  let liberar: () => void = () => {};
  const segura = new Promise<void>((r) => { liberar = r; });
  vi.stubGlobal('fetch', vi.fn(async () => { await segura; return new Response(jpeg()); }));
  render(<BaixarFotos mlItemId="MLB1" ids={ids.slice(0, 1)} clips={0} />);
  const botao = screen.getByRole('button', { name: /Baixar fotos/ });
  botao.focus();
  fireEvent.click(botao);
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' })));
  liberar();
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Salvar o ZIP de novo' })));
});

it('Grok: foco que saiu do bloco não é puxado de volta na conclusão', async () => {
  let liberar: () => void = () => {};
  const segura = new Promise<void>((r) => { liberar = r; });
  vi.stubGlobal('fetch', vi.fn(async () => { await segura; return new Response(jpeg()); }));
  render(<><button type="button">fora</button><BaixarFotos mlItemId="MLB1" ids={ids.slice(0, 1)} clips={0} /></>);
  fireEvent.click(screen.getByRole('button', { name: /Baixar fotos/ }));
  await screen.findByRole('button', { name: 'Cancelar' });
  const fora = screen.getByRole('button', { name: 'fora' });
  fora.focus();
  liberar();
  await screen.findByRole('button', { name: 'Salvar o ZIP de novo' });
  expect(document.activeElement).toBe(fora);
});

it('Cancelar volta ao botão sem pedir download; desmontar revoga o ZIP gerado', async () => {
  let liberar: () => void = () => {};
  const segura = new Promise<void>((r) => { liberar = r; });
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    await Promise.race([segura, new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(init.signal!.reason)))]);
    return new Response(jpeg());
  }));
  const { unmount } = render(<BaixarFotos mlItemId="MLB1" ids={ids.slice(0, 1)} clips={0} />);
  fireEvent.click(screen.getByRole('button', { name: /Baixar fotos/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
  await screen.findByRole('button', { name: /Baixar fotos/ });
  expect(salvos).toEqual([]);
  liberar();
  fireEvent.click(screen.getByRole('button', { name: /Baixar fotos/ }));
  await screen.findByText(/Download solicitado/);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:zip');
});
