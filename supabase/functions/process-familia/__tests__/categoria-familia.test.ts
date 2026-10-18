import { describe, it, expect } from 'vitest';
import { inputCategoriaDaFamilia, categoriaPorCatalogo } from '../categoria-familia';
import { resolverCategoria } from '../../_shared/categoria/resolver';
import { montarPromptDesempate } from '../../_shared/ai/categoria-llm-core';
import type { CategoriaCandidata } from '../../_shared/ml/domain-discovery';

const adulto: CategoriaCandidata = { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB188064', categoriaNome: 'Bermudas e Shorts' };
const bebe: CategoriaCandidata = { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB278065', categoriaNome: 'Shorts' };
const outros: CategoriaCandidata = { domainId: 'MLB-X', domainName: 'X', categoriaId: 'MLB1', categoriaNome: 'Outros' };

const claim = { nome_pai: 'SHORT TACTEL 00000010', descricao_pai: 'Short de tactel', genero: 'masculino' };

describe('inputCategoriaDaFamilia (claim → InputCategoria)', () => {
  it('mapeia nome, descrição, gênero e a busca limpa', () => {
    expect(inputCategoriaDaFamilia(claim, 'short')).toEqual({
      nome: 'SHORT TACTEL 00000010', descricao: 'Short de tactel', genero: 'masculino', tipoProdutoBusca: 'short',
    });
  });
  it('grade_tamanho válida chega ao resolver; valor desconhecido é ignorado', () => {
    expect(inputCategoriaDaFamilia({ ...claim, grade_tamanho: 'infantil' }).grade).toBe('infantil');
    expect(inputCategoriaDaFamilia({ ...claim, grade_tamanho: 'xpto' }).grade).toBeUndefined();
    expect(inputCategoriaDaFamilia({ ...claim, grade_tamanho: null }).grade).toBeUndefined();
  });
  it('descrição/gênero null → descrição ausente, gênero null', () => {
    const i = inputCategoriaDaFamilia({ nome_pai: 'X', descricao_pai: null, genero: null });
    expect(i.descricao).toBeUndefined();
    expect(i.genero).toBeNull();
  });
  it('percurso claim → resolver → prompt: o gênero gravado chega ao prompt', async () => {
    let prompt = '';
    await resolverCategoria(inputCategoriaDaFamilia(claim), {
      preditor: async () => [bebe, adulto],
      llm: async (input, cands) => { prompt = montarPromptDesempate(input, cands); return undefined; },
    });
    expect(prompt).toContain('Gênero: Masculino (adulto)');
  });
});

describe('categoriaPorCatalogo (fallback pelo nome do catálogo do concorrente)', () => {
  const input = inputCategoriaDaFamilia(claim);

  it('1º candidato infantil p/ produto adulto passa pelo desempate (LLM escolhe o adulto)', async () => {
    let vistos: CategoriaCandidata[] = [];
    let generoVisto: string | null | undefined;
    const r = await categoriaPorCatalogo(input, 'Short Tactel Masculino', {
      preditor: async (q) => { expect(q).toBe('Short Tactel Masculino'); return [bebe, adulto]; },
      llm: async (i, cands) => { vistos = cands; generoVisto = i.genero; return 'MLB188064'; },
    });
    expect(vistos.map((c) => c.categoriaId)).toEqual(['MLB278065', 'MLB188064']);
    expect(generoVisto).toBe('masculino');
    expect(r).toMatchObject({ categoriaId: 'MLB188064', origem: 'ia' });
  });

  it('LLM falha tecnicamente → 1º específico (comportamento de hoje)', async () => {
    const r = await categoriaPorCatalogo(input, 'q', { preditor: async () => [outros, bebe], llm: async () => undefined });
    expect(r).toMatchObject({ categoriaId: 'MLB278065', origem: 'preditor' });
  });

  it('abstenção → null (mantém o resultado textual)', async () => {
    expect(await categoriaPorCatalogo(input, 'q', { preditor: async () => [outros, bebe], llm: async () => null })).toBeNull();
  });

  it('só genérico → null (catálogo nunca aplicou genérico)', async () => {
    expect(await categoriaPorCatalogo(input, 'q', { preditor: async () => [outros], llm: async () => 'MLB1' })).toBeNull();
  });

  it('preditor lança → null', async () => {
    expect(await categoriaPorCatalogo(input, 'q', { preditor: async () => { throw new Error('x'); } })).toBeNull();
  });
});
