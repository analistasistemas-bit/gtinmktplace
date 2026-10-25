// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../leitura/pdp', () => ({
  ehPaginaCatalogo: () => false,
  lerAnuncio: () => ({ ok: true, dados: { mlItemId: 'MLB1', sellerId: 1, catalogProductId: null, categoriaId: 'MLB2', preco: 10, vendidosTexto: null, lojaOficial: false, qualidade: {} } }),
}));
vi.mock('../leitura-estavel', () => ({ lerComReleitura: async (ler: () => unknown) => ler(), esperarPaginaEstavel: async () => {} }));
vi.mock('../../compartilhado/qualidade', () => ({ avaliarQualidade: () => ({ fotosFracas: [] }) }));

let estado: { ativa: boolean; logado: boolean } = { ativa: true, logado: true };
let ouvinte: (m: unknown) => void = () => {};
let soltar: (r: unknown) => void = () => {};
let segurar = false;
let respostaAnalise: unknown;
const analises = vi.fn();
const OK = { ok: true, dados: { proprio: true, catalogoCriadoEm: null, vendedor: null, margem: null } };
const enviar = vi.fn(async (m: { tipo: string; corpo?: { acao: string } }) => {
  if (m.tipo === 'publiai:estado-extensao') return estado;
  if (m.tipo === 'publiai:chamar' && m.corpo?.acao === 'analisar_anuncio') {
    analises();
    return segurar ? new Promise((r) => { soltar = r; }) : respostaAnalise;
  }
  return undefined;
});
const selos = () => document.querySelectorAll('#publiai-selo').length;
const aviso = (tipo: string, ativa: boolean, logado = true) => ouvinte({ tipo, ativa, logado, geracao: 1 });
const folga = () => new Promise((r) => setTimeout(r, 0));

let mod: typeof import('../anuncio');
async function carregar() {
  vi.resetModules();
  document.body.innerHTML = '<h1>Produto</h1>';
  vi.stubGlobal('chrome', { runtime: { sendMessage: enviar, getManifest: () => ({ version: '1' }), onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; } } } });
  mod = await import('../anuncio');
  await folga();
}

beforeEach(() => { estado = { ativa: true, logado: true }; segurar = false; respostaAnalise = OK; analises.mockClear(); enviar.mockClear(); });

describe('anúncio obedece à chave ativa', () => {
  it('boot desligado → nenhuma análise pedida e nenhum selo', async () => {
    estado = { ativa: false, logado: true };
    await carregar();
    expect(analises).not.toHaveBeenCalled();
    expect(selos()).toBe(0);
  });
  it('deslogado → sem selo e sem análise', async () => {
    estado = { ativa: true, logado: false };
    await carregar();
    expect(analises).not.toHaveBeenCalled();
    expect(selos()).toBe(0);
  });
  it('resposta sem_sessao da análise → sem selo "conecte a extensão"', async () => {
    respostaAnalise = { ok: false, erro: 'sem_sessao' };
    await carregar();
    expect(analises).toHaveBeenCalledTimes(1);
    expect(selos()).toBe(0);
  });
  it('boot ligado → um selo', async () => {
    await carregar();
    expect(selos()).toBe(1);
  });
  it('ativacao false com análise em voo → resposta descartada', async () => {
    segurar = true;
    await carregar();
    expect(analises).toHaveBeenCalledTimes(1);
    aviso('publiai:ativacao', false);
    soltar(OK);
    await folga();
    expect(selos()).toBe(0);
  });
  it('ativacao false remove selo e contorno já na página', async () => {
    await carregar();
    expect(selos()).toBe(1);
    document.body.insertAdjacentHTML('beforeend', '<div data-publiai-foto-fraca="x" style="outline:2px solid red"></div>');
    aviso('publiai:ativacao', false);
    expect(selos()).toBe(0);
    expect(document.querySelector('[data-publiai-foto-fraca]')).toBeNull();
  });
  it('ativacao true → roda de novo e recoloca o selo, sem duplicar', async () => {
    await carregar();
    aviso('publiai:ativacao', false);
    aviso('publiai:ativacao', true);
    aviso('publiai:conta-mudou', true); // aviso em dobro
    await folga();
    expect(selos()).toBe(1);
    expect(analises).toHaveBeenCalledTimes(2); // boot + a última (a 1ª do par em dobro foi invalidada antes de chamar)
    await mod.rodar();
    expect(selos()).toBe(1);
  });
  it('conta-mudou deslogado → remove o selo', async () => {
    await carregar();
    aviso('publiai:conta-mudou', true, false);
    expect(selos()).toBe(0);
  });
});
