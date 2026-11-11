// Lupa pela caixa do produto no passo Roteiro: motivo por missão e "ativar" barrado só se TODAS as cores estão bloqueadas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PassoRoteiro } from '../passo-roteiro';
import type { Ficha, RespostaRoteiro } from '@/lib/galeria/api';

/** null = a trava real (MISSOES_LUPA_PENDENTE); {geral:[],moda:[]} = ramo liberado depois do portão (Task 16). */
const trava = vi.hoisted(() => ({ travas: null as null | { geral: number[]; moda: number[] } }));
vi.mock('../../../../supabase/functions/_shared/galeria/regras', async (orig) => {
  const r = await orig<typeof import('../../../../supabase/functions/_shared/galeria/regras')>();
  return { ...r, lupaPendente: (m: number, moda: boolean) => r.lupaPendente(m, moda, trava.travas ?? r.MISSOES_LUPA_PENDENTE) };
});

const ficha = (extra: Partial<Ficha> = {}): Ficha => ({
  anuncio_externo_id: 'A1', familia_id: 'F1', codigo_pai: '0001', cores: ['Preto', 'Rosa'], fatos: [], fatos_hash: 'h',
  roteiro_desatualizado: false, referencias: {}, ...extra,
});
const resp = (ativas: number[]): RespostaRoteiro => ({
  roteiro: { id: 'R1', familia_id: 'F1', versao: 1, status: 'rascunho', moda: false,
    conteudo: { categoria: 'c', contrato: 'k', missoes: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ missao: n, ativa: ativas.includes(n), cena: `cena ${n}`, fatosUsados: [] })) } },
  erros: [], erros_por_missao: {}, ciencia_pendente: [], fatos: [],
});
const lupa = (r3: 'ok' | 'lendo' | 'indisponivel', r7 = r3) => ({ geral: { 3: r3, 7: r7 }, moda: { 5: 'ok' as const, 7: 'ok' as const } });
const montar = (f: Ficha, ativas: number[]) => render(
  <PassoRoteiro mlItemId="MLB1" ficha={f} isAdmin podeCriar={false} resp={resp(ativas)} aoResposta={vi.fn()} aoFalhar={vi.fn()} aoAprovar={vi.fn()} />,
);
const ativa = (n: number) => screen.getByRole('checkbox', { name: `Missão ${n} ativa` });

beforeEach(() => { trava.travas = null; });

describe('PassoRoteiro — lupa', () => {
  it('lupa travada: motivo nas missões 3 e 7 e ativar barrado; desativar segue livre', () => {
    montar(ficha(), [1, 2, 3]);
    expect(screen.getAllByText('lupa em ajuste')).toHaveLength(2);
    expect(ativa(3)).toBeEnabled(); // já ativa: dá para desativar
    expect(ativa(7)).toBeDisabled();
    expect(ativa(1)).toBeEnabled();
  });

  it('ramo liberado: sem detalhe em UMA cor mostra o motivo com a cor e mantém ativar; em TODAS barra o ativar', () => {
    trava.travas = { geral: [], moda: [] };
    const { unmount } = montar(ficha({ lupa: { Preto: lupa('ok'), Rosa: lupa('indisponivel', 'ok') } }), [1]);
    expect(screen.getByText('sem detalhe do produto na foto: Rosa')).toBeInTheDocument();
    expect(ativa(3)).toBeEnabled();
    unmount();
    montar(ficha({ lupa: { Preto: lupa('indisponivel', 'ok'), Rosa: lupa('indisponivel', 'ok') } }), [1]);
    expect(screen.getByText('sem detalhe do produto na foto: Preto, Rosa')).toBeInTheDocument();
    expect(ativa(3)).toBeDisabled();
    expect(ativa(7)).toBeEnabled();
  });

  it('ramo liberado com a lupa ainda sendo lida: motivo "lendo a foto" e sem barrar quem lê só em parte', () => {
    trava.travas = { geral: [], moda: [] };
    montar(ficha({ lupa: { Preto: lupa('ok'), Rosa: lupa('lendo') } }), [1]);
    expect(screen.getAllByText('lendo a foto de referência: Rosa')).toHaveLength(2);
    expect(ativa(3)).toBeEnabled();
  });
});
