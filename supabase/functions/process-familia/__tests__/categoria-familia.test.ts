import { describe, it, expect } from 'vitest';
import { inputCategoriaDaFamilia, categoriaPorCatalogo, categoriaPorBuscaCatalogo } from '../categoria-familia';
import { parseFichasBusca } from '../../_shared/ml/catalogo';
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

describe('categoriaPorBuscaCatalogo (resgate quando o GTIN não casa no catálogo)', () => {
  const corpo: CategoriaCandidata = { domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS', domainName: 'Cuidado do corpo', categoriaId: 'MLB1262', categoriaNome: 'Cuidado do Corpo' };
  const cremeBebe: CategoriaCandidata = { domainId: 'MLB-BABY_CREAMS_AND_OINTMENTS', domainName: 'Cremes de bebê', categoriaId: 'MLB277750', categoriaNome: 'Cremes, Pomadas e Óleos' };
  const input = inputCategoriaDaFamilia({ nome_pai: 'EUCERIN DUO PACK AQUAPHOR 18G', descricao_pai: null, genero: null });
  const fichas = async () => [
    { nome: 'Eucerin Aquaphor', domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS' },
    { nome: 'Plastimodelismo Pack', domainId: 'MLB-MODELS' },
  ];

  it('caso real 00000204: só candidatos do domínio da ficha chegam ao desempate', async () => {
    let vistos: CategoriaCandidata[] = [];
    const consultas: string[] = [];
    const r = await categoriaPorBuscaCatalogo(input, {
      preditor: async (q) => { consultas.push(q); return [cremeBebe, corpo]; },
      llm: async (_i, cands) => { vistos = cands; return 'MLB1262'; },
    }, fichas);
    expect(consultas).toEqual(['Eucerin Aquaphor']);
    expect(vistos).toEqual([corpo]);
    expect(r).toMatchObject({ categoriaId: 'MLB1262' });
  });

  it('nome sem 2 palavras reais em comum com a ficha não gera candidato', async () => {
    const i = inputCategoriaDaFamilia({ nome_pai: 'ZX123 KIT 44 PRO', descricao_pai: null, genero: null });
    const r = await categoriaPorBuscaCatalogo(i, {
      preditor: async () => { throw new Error('não deveria consultar'); },
      llm: async () => 'MLB1262',
    }, async () => [{ nome: 'Kit Ferramentas Bike 44 Chaves Pro', domainId: 'MLB-TOOLS' }]);
    expect(r).toBeNull();
  });

  it('compara palavras sem acento e sem caixa', async () => {
    const i = inputCategoriaDaFamilia({ nome_pai: 'POMADA REPARADORA', descricao_pai: null, genero: null });
    const r = await categoriaPorBuscaCatalogo(i, { preditor: async () => [corpo], llm: async () => 'MLB1262' },
      async () => [{ nome: 'Pômada Reparadôra', domainId: corpo.domainId }]);
    expect(r).toMatchObject({ categoriaId: 'MLB1262' });
  });

  it('usa no máximo 5 fichas', async () => {
    const consultas: string[] = [];
    await categoriaPorBuscaCatalogo(input, { preditor: async (q) => { consultas.push(q); return []; }, llm: async () => null },
      async () => Array.from({ length: 8 }, (_, n) => ({ nome: `Eucerin Aquaphor ${n}`, domainId: corpo.domainId })));
    expect(consultas).toHaveLength(5);
  });

  it('abstenção, falha técnica e id fora da lista → null (nunca aplica categoria sem confirmação)', async () => {
    const preditor = async () => [corpo];
    expect(await categoriaPorBuscaCatalogo(input, { preditor, llm: async () => null }, fichas)).toBeNull();
    expect(await categoriaPorBuscaCatalogo(input, { preditor, llm: async () => undefined }, fichas)).toBeNull();
    expect(await categoriaPorBuscaCatalogo(input, { preditor, llm: async () => { throw new Error('x'); } }, fichas)).toBeNull();
    expect(await categoriaPorBuscaCatalogo(input, { preditor, llm: async () => 'MLB999' }, fichas)).toBeNull();
    expect(await categoriaPorBuscaCatalogo(input, { preditor }, fichas)).toBeNull();
  });

  it('busca ou preditor lançam → null', async () => {
    expect(await categoriaPorBuscaCatalogo(input, { preditor: async () => [corpo], llm: async () => 'MLB1262' }, async () => { throw new Error('x'); })).toBeNull();
    expect(await categoriaPorBuscaCatalogo(input, { preditor: async () => { throw new Error('x'); }, llm: async () => 'MLB1262' }, fichas)).toBeNull();
  });
});

describe('parseFichasBusca', () => {
  it('mantém nome e domínio; descarta resultado incompleto', () => {
    expect(parseFichasBusca({ results: [{ name: 'A', domain_id: 'MLB-A' }, { name: 'B' }, { domain_id: 'MLB-C' }] }))
      .toEqual([{ nome: 'A', domainId: 'MLB-A' }]);
    expect(parseFichasBusca(null)).toEqual([]);
  });
});
