// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Radar } from '../Radar';

afterEach(() => cleanup());
const ok = <T,>(dados: T) => ({ ok: true as const, dados });
const noRadar = {
  modulo: true, noRadar: true, status: 'ativo', ultimaColetaEm: '2026-10-22T13:00:00Z', ofertasAtivas: 7, menorPrecoObservado: 18.4, meuPreco: 19.9,
  referenciaML: { preco: 18.3, atualizadoEm: '2026-10-22T12:00:00Z' },
  alertas: [{ tipo: 'preco_caiu', criadoEm: '2026-10-22T12:30:00Z', acao: true, de: 20, para: 18.4, preco: null, vendedor: null }],
};

it('módulo Pulse desligado: o bloco some', async () => {
  const chamar = vi.fn(async () => ok({ modulo: false }));
  const { container } = render(<Radar catalogProductId="MLB1" chamar={chamar as never} />);
  await vi.waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: 'radar', catalogProductId: 'MLB1' }));
  await vi.waitFor(() => expect(container.innerHTML).toBe(''));
});

it('no radar: menor preço observado, ofertas, seu preço, referência do ML e alerta; link para o Pulse', async () => {
  render(<Radar catalogProductId="MLB1" chamar={vi.fn(async () => ok(noRadar)) as never} />);
  await screen.findByText('No radar');
  screen.getByText('Menor preço observado');
  screen.getByText(/^Preço sugerido pelo ML em \d{2}\/\d{2}$/);
  screen.getByText(/Menor preço relevante caiu de R\$\s?20,00 para R\$\s?18,40/);
  expect(screen.getByRole('link', { name: 'Abrir no Pulse' }).getAttribute('href')).toMatch(/#\/pulse$/);
});

it('aguardando a 1ª coleta: sem números inventados', async () => {
  render(<Radar catalogProductId="MLB1" chamar={vi.fn(async () => ok({ ...noRadar, ultimaColetaEm: null, ofertasAtivas: null, menorPrecoObservado: null, alertas: [] })) as never} />);
  await screen.findByText('Aguardando a primeira coleta do Pulse.');
  expect(screen.queryByText('Menor preço observado')).toBeNull();
});

it('fora do radar: adicionar pede confirmação, envia só o id e recarrega o radar', async () => {
  const chamar = vi.fn(async (c: { acao: string }) => {
    if (c.acao === 'adicionar_radar') return ok({ estado: 'ok', jaExistia: false });
    return chamar.mock.calls.length > 2 ? ok({ ...noRadar, ultimaColetaEm: null, alertas: [] }) : ok({ modulo: true, noRadar: false });
  });
  render(<Radar catalogProductId="MLB1" chamar={chamar as never} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao radar' }));
  screen.getByText(/Só o código do catálogo é enviado/);
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  await screen.findByText('Adicionado ao radar.', { selector: '.rd-ok' });
  expect(chamar).toHaveBeenCalledWith({ acao: 'adicionar_radar', catalogProductId: 'MLB1' });
  screen.getByText('Aguardando a primeira coleta do Pulse.');
});

it('erro: mensagem e Tentar de novo', async () => {
  const chamar = vi.fn(async () => ({ ok: false as const, erro: 'interno' }));
  render(<Radar catalogProductId="MLB1" chamar={chamar as never} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
  await vi.waitFor(() => expect(chamar).toHaveBeenCalledTimes(2));
});

it('foco e status: abrir → Adicionar; cancelar → Adicionar ao radar; sucesso → Abrir no Pulse e anúncio na região de status', async () => {
  const chamar = vi.fn(async (c: { acao: string }) => {
    if (c.acao === 'adicionar_radar') return ok({ estado: 'ok', jaExistia: false });
    return chamar.mock.calls.some(([x]) => (x as { acao: string }).acao === 'adicionar_radar') ? ok({ ...noRadar, alertas: [] }) : ok({ modulo: true, noRadar: false });
  });
  render(<Radar catalogProductId="MLB1" chamar={chamar as never} />);
  const abrir = await screen.findByRole('button', { name: 'Adicionar ao radar' });
  abrir.focus();
  fireEvent.click(abrir);
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Adicionar' })));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Adicionar ao radar' })));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao radar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar' }));
  await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Abrir no Pulse' })));
  expect(screen.getByRole('status').textContent).toBe('Adicionado ao radar.');
});

it('pausado: selo e aviso de coletas paradas', async () => {
  render(<Radar catalogProductId="MLB1" chamar={vi.fn(async () => ok({ ...noRadar, status: 'pausado' })) as never} />);
  await screen.findByText('Pausado');
  screen.getByText(/sem coletas novas até reativar/);
});

it('Grok: limite e falha ao adicionar com texto do radar (não "analisar este anúncio")', async () => {
  let resposta: unknown = ok({ estado: 'limite', maximoPorHora: 10 });
  const chamar = vi.fn(async (c: { acao: string }) => (c.acao === 'adicionar_radar' ? resposta : ok({ modulo: true, noRadar: false })));
  render(<Radar catalogProductId="MLB1" chamar={chamar as never} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar ao radar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  await screen.findByText('No máximo 10 inclusões no radar por hora. Tente de novo mais tarde.', { selector: '.rd-aviso' });
  resposta = { ok: false, erro: 'interno' };
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar ao radar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
  await screen.findByText('Não foi possível adicionar agora. Tente de novo.', { selector: '.rd-aviso' });
});
