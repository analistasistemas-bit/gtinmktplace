import { describe, it, expect } from 'vitest';
import { escolherCandidatoValido, montarPromptDesempate } from '../categoria-llm-core';
import type { CategoriaCandidata } from '../../ml/domain-discovery';

const candidatos: CategoriaCandidata[] = [
  { domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
  { domainId: 'MLB-HAMMER_DRILLS', domainName: 'Furadeiras', categoriaId: 'MLB430376', categoriaNome: 'Marteletes' },
];

describe('escolherCandidatoValido (closed-set)', () => {
  it('id na lista → devolve o id', () => {
    expect(escolherCandidatoValido('MLB430376', candidatos)).toBe('MLB430376');
  });
  it('id fora da lista → null (não inventa)', () => {
    expect(escolherCandidatoValido('MLB000000', candidatos)).toBeNull();
  });
  it('null/undefined → null', () => {
    expect(escolherCandidatoValido(null, candidatos)).toBeNull();
    expect(escolherCandidatoValido(undefined, candidatos)).toBeNull();
  });
});

describe('montarPromptDesempate', () => {
  it('lista os category_id e inclui o nome do produto', () => {
    const p = montarPromptDesempate({ nome: 'Martelete' }, candidatos);
    expect(p).toContain('MLB189007');
    expect(p).toContain('MLB430376');
    expect(p).toContain('Martelete');
  });
  it('inclui a descrição quando presente', () => {
    expect(montarPromptDesempate({ nome: 'X', descricao: 'demolidor 1500W' }, candidatos)).toContain('demolidor 1500W');
  });

  it('instrui a IA a devolver null quando nenhum candidato serve, mesmo sendo o único', () => {
    const p = montarPromptDesempate({ nome: 'X' }, candidatos);
    expect(p.toLowerCase()).toContain('null');
  });
});
