// Fase B (plano 2026-11-11, Ajuste v2-5 e seção (c) da revisão): salvamento automático do roteiro sem perder edição.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useRascunhoRoteiro } from '../useRascunhoRoteiro';
import type { Fato, Res, RespostaRoteiro, Roteiro } from '@/lib/galeria/api';
import { definirSpec, removerSpec, specsElegiveis } from '@/lib/galeria/rascunho';

const api = vi.hoisted(() => ({ salvarRoteiro: vi.fn() }));
vi.mock('@/lib/galeria/api', async (orig) => ({ ...(await orig<typeof import('@/lib/galeria/api')>()), ...api }));

const conteudo = (headline = 'Versátil no dia a dia'): Roteiro => ({
  categoria: 'c', contrato: 'contrato',
  missoes: [{ missao: 1, ativa: true, cena: 'cena 1', fatosUsados: [] }, { missao: 2, ativa: true, cena: 'cena 2', headline, fatosUsados: [] }],
});
const resp = (c: Roteiro, extra: { id?: string; status?: string; pendentes?: string[] } = {}): RespostaRoteiro => ({
  roteiro: { id: extra.id ?? 'R1', familia_id: 'F1', versao: 1, status: extra.status ?? 'rascunho', moda: false, conteudo: c },
  erros: [], erros_por_missao: {}, ciencia_pendente: extra.pendentes ?? [], fatos: [],
});
const ok = <T,>(dados: T): Res<T> => ({ ok: true, dados });
const falha = (erro: string): Res<never> => ({ ok: false, status: 500, erro, corpo: {} });

function adiado<T>() {
  let resolver: (v: T) => void = () => undefined;
  const promessa = new Promise<T>((r) => { resolver = r; });
  return { promessa, resolver };
}

const aoFalhar = vi.fn();
const aoResposta = vi.fn();

/** O hook dentro de um "pai" que guarda a resposta, como a página faz. */
function montar(inicial: RespostaRoteiro, podeEditar = true) {
  return renderHook(() => {
    const [r, setR] = useState<RespostaRoteiro | null>(inicial);
    const h = useRascunhoRoteiro({
      mlItemId: 'MLB1', familiaId: 'F1', resp: r, podeEditar, aoFalhar,
      aoResposta: (x) => { aoResposta(x); setR(x); },
    });
    return { ...h, resp: r, setResp: setR };
  });
}
const titulo = (h: { rascunho: Roteiro | null }) => h.rascunho?.missoes[1].headline;
const mudarTitulo = (t: string) => (r: Roteiro) => ({ ...r, missoes: r.missoes.map((m) => (m.missao === 2 ? { ...m, headline: t } : m)) });

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('useRascunhoRoteiro — salvamento automático', () => {
  it('editar agenda um salvar (debounce) com o snapshot; "Salvo" quando volta', async () => {
    api.salvarRoteiro.mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c)));
    const { result } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Fita macia')));
    expect(result.current.estado).toBe('pendente');
    act(() => result.current.editar(mudarTitulo('Fita macia para laços')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1);
    expect(api.salvarRoteiro.mock.calls[0][3].missoes[1].headline).toBe('Fita macia para laços');
    expect(result.current.estado).toBe('salvo');
  });

  it('um salvar em voo por vez; edição durante o voo não é perdida e sai no salvar seguinte', async () => {
    const primeiro = adiado<Res<RespostaRoteiro>>();
    api.salvarRoteiro.mockReturnValueOnce(primeiro.promessa).mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c)));
    const { result } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Um')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.estado).toBe('salvando');
    act(() => result.current.editar(mudarTitulo('Um dois')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1); // o 1º ainda em voo
    await act(async () => { primeiro.resolver(ok(resp(conteudo('Um')))); await vi.advanceTimersByTimeAsync(0); });
    expect(titulo(result.current)).toBe('Um dois'); // a resposta não sobrescreve o que foi digitado durante o voo
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(2);
    expect(api.salvarRoteiro.mock.calls[1][3].missoes[1].headline).toBe('Um dois');
    expect(result.current.estado).toBe('salvo');
  });

  it('resposta de uma abertura antiga (recarga no meio do voo) é descartada', async () => {
    const lento = adiado<Res<RespostaRoteiro>>();
    api.salvarRoteiro.mockReturnValueOnce(lento.promessa);
    const { result } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Velho')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.setResp(resp(conteudo('Recarregado'), { id: 'R2' })));
    await act(async () => { lento.resolver(ok(resp(conteudo('Velho')))); await vi.advanceTimersByTimeAsync(0); });
    expect(aoResposta).not.toHaveBeenCalled();
    expect(titulo(result.current)).toBe('Recarregado');
    expect(result.current.resp?.roteiro.id).toBe('R2');
  });

  it('falha mostra "erro" e avisa o pai; "Tentar de novo" reenvia e volta a "Salvo"', async () => {
    api.salvarRoteiro.mockResolvedValueOnce(falha('falha_interna')).mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c)));
    const { result } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Fita')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.estado).toBe('erro');
    expect(result.current.erro).toMatch(/Erro interno/);
    expect(aoFalhar).toHaveBeenCalledWith(expect.objectContaining({ erro: 'falha_interna' }));
    expect(titulo(result.current)).toBe('Fita'); // o texto continua na tela
    await act(async () => { await result.current.tentarDeNovo(); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(2);
    expect(result.current.estado).toBe('salvo');
  });

  it('descarregar envia o pendente na hora (troca de passo/saída), sem esperar o debounce', async () => {
    api.salvarRoteiro.mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c)));
    const { result } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Agora')));
    let salvou = false;
    await act(async () => { salvou = await result.current.descarregar(); });
    expect(salvou).toBe(true);
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1); // o debounce não manda de novo
  });

  it('desmontar com edição pendente envia o pendente', async () => {
    api.salvarRoteiro.mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c)));
    const { result, unmount } = montar(resp(conteudo()));
    act(() => result.current.editar(mudarTitulo('Saindo')));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1);
    expect(api.salvarRoteiro.mock.calls[0][3].missoes[1].headline).toBe('Saindo');
  });
});

describe('useRascunhoRoteiro — roteiro aprovado e permissão', () => {
  it('aprovado: editar não muda nada nem cria versão; "Editar" cria a versão nova uma vez e as edições seguintes usam o id novo', async () => {
    api.salvarRoteiro.mockImplementation(async (_m, _f, id: string, c: Roteiro) => ok(resp(c, { id: id === 'R1' ? 'R2' : id })));
    const { result } = montar(resp(conteudo(), { status: 'aprovado' }));
    expect(result.current.editavel).toBe(false);
    act(() => result.current.editar(mudarTitulo('Acidente')));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.salvarRoteiro).not.toHaveBeenCalled();
    expect(titulo(result.current)).toBe('Versátil no dia a dia');
    await act(async () => { await result.current.editarAprovado(); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1);
    expect(result.current.resp?.roteiro.id).toBe('R2');
    expect(result.current.editavel).toBe(true);
    act(() => result.current.editar(mudarTitulo('Nova versão')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(2);
    expect(api.salvarRoteiro.mock.calls[1][2]).toBe('R2');
  });

  it('não-admin vê só leitura: editar e "Editar" não chamam o servidor', async () => {
    const { result } = montar(resp(conteudo()), false);
    expect(result.current.editavel).toBe(false);
    act(() => result.current.editar(mudarTitulo('X')));
    await act(async () => { await result.current.editarAprovado(); await vi.advanceTimersByTimeAsync(2000); });
    expect(api.salvarRoteiro).not.toHaveBeenCalled();
  });

  it('a ciência marcada não zera quando o salvar responde', async () => {
    api.salvarRoteiro.mockImplementation(async (_m, _f, _id, c: Roteiro) => ok(resp(c, { pendentes: ['atributo:MATERIAL'] })));
    const { result } = montar(resp(conteudo(), { pendentes: ['atributo:MATERIAL'] }));
    act(() => result.current.marcarCiencia(true));
    expect(result.current.faltaCiencia).toBe(false);
    act(() => result.current.editar(mudarTitulo('Outro')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.salvarRoteiro).toHaveBeenCalledTimes(1);
    expect(result.current.faltaCiencia).toBe(false);
  });
});

describe('edições puras do rascunho', () => {
  const fato = (campo: string, valor: string, estado: Fato['estado'] = 'CONFIRMADO'): Fato => ({ campo, valor, estado, origem: 'planilha' });

  it('remover spec é pela posição: com o mesmo campo repetido, só a escolhida sai', () => {
    const r: Roteiro = { categoria: 'c', contrato: 'k', missoes: [{ missao: 5, ativa: true, cena: 'c', fatosUsados: [], specs: [
      { campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' },
      { campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' },
    ] }] };
    expect(removerSpec(r, 5, 1).missoes[0].specs).toEqual([{ campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' }]);
  });

  it('spec escolhida de um dado vem com rótulo e valor do dado; posição nova acrescenta', () => {
    const r: Roteiro = { categoria: 'c', contrato: 'k', missoes: [{ missao: 5, ativa: true, cena: 'c', fatosUsados: [] }] };
    const com = definirSpec(r, 5, 0, fato('atributo:MATERIAL', '100% poliéster'));
    expect(com.missoes[0].specs).toEqual([{ campo: 'atributo:MATERIAL', rotulo: 'Material', valor: '100% poliéster' }]);
    expect(definirSpec(com, 5, 9, fato('atributo:LENGTH', '25 m')).missoes[0].specs).toHaveLength(2);
  });

  it('lista de dados para a ficha técnica: só confirmados, sem embalagem, sem texto longo, e que cabem na caixa', () => {
    const lista = specsElegiveis([
      fato('atributo:MATERIAL', '100% poliéster'), fato('atributo:WIDTH', '16 mm', 'NAO_CONFERIDO'),
      fato('atributo:COLOR', 'Branco', 'SUGERIDO'), fato('largura_cm', '24.50'), fato('descricao_ml', '100% poliéster'),
      fato('nome', 'FITAS DE VELUDO 16MM CORES C/25MTS'),
    ]).map((f) => f.campo);
    expect(lista).toEqual(['atributo:MATERIAL', 'atributo:WIDTH']);
  });
});
