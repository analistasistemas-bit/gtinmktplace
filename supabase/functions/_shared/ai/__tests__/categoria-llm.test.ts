import { describe, it, expect } from 'vitest';
import { escolherCandidatoValido, montarPromptDesempate, ehAbstencaoDeliberada } from '../categoria-llm-core';
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

// Caso real 2026-10-17 (short 00000010, org Zaven): mesmo domínio MLB-SHORTS, públicos diferentes.
const shorts: CategoriaCandidata[] = [
  { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB188064', categoriaNome: 'Bermudas e Shorts' },
  { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB278065', categoriaNome: 'Shorts' },
];

describe('montarPromptDesempate — caminho e gênero (ADR-0026 emenda 2026-10-17)', () => {
  it('com caminhos: cada candidato mostra o caminho completo', () => {
    const p = montarPromptDesempate({ nome: 'Short masculino' }, shorts, {
      MLB278065: 'Bebês > Roupas de Bebê > Shorts',
      MLB188064: 'Calçados, Roupas e Bolsas > Bermudas e Shorts',
    });
    expect(p).toContain('MLB278065 — Bebês > Roupas de Bebê > Shorts');
    expect(p).toContain('MLB188064 — Calçados, Roupas e Bolsas > Bermudas e Shorts');
  });
  it('sem caminho para um id → linha atual "domínio > folha"', () => {
    const p = montarPromptDesempate({ nome: 'Short' }, shorts, { MLB278065: 'Bebês > Roupas de Bebê > Shorts' });
    expect(p).toContain('MLB188064 — Shorts > Bermudas e Shorts');
    expect(p).toContain('MLB278065 — Bebês > Roupas de Bebê > Shorts');
  });
  it('gênero masculino → "Gênero: Masculino (adulto)"', () => {
    expect(montarPromptDesempate({ nome: 'Short', genero: 'masculino' }, shorts)).toContain('Gênero: Masculino (adulto)');
  });
  it('gênero meninos → "Gênero: Meninos (infantil)"', () => {
    expect(montarPromptDesempate({ nome: 'Short', genero: 'meninos' }, shorts)).toContain('Gênero: Meninos (infantil)');
  });
  it('rotula os seis gêneros do CHECK de familias.genero', () => {
    const esperado: Record<string, string> = {
      masculino: 'Masculino (adulto)', feminino: 'Feminino (adulto)', unissex: 'Unissex (adulto)',
      meninos: 'Meninos (infantil)', meninas: 'Meninas (infantil)', sem_genero_infantil: 'Sem gênero infantil (infantil)',
    };
    for (const [g, rotulo] of Object.entries(esperado)) {
      expect(montarPromptDesempate({ nome: 'X', genero: g }, shorts)).toContain(`Gênero: ${rotulo}`);
    }
  });
  it('sem gênero (ou valor desconhecido) → sem a linha', () => {
    expect(montarPromptDesempate({ nome: 'Short' }, shorts)).not.toContain('Gênero:');
    expect(montarPromptDesempate({ nome: 'Short', genero: null }, shorts)).not.toContain('Gênero:');
    expect(montarPromptDesempate({ nome: 'Short', genero: 'xyz' }, shorts)).not.toContain('Gênero:');
  });
  it('instrui a respeitar o público (adulto/infantil/bebê/gestante)', () => {
    expect(montarPromptDesempate({ nome: 'Short' }, shorts)).toContain('adulto/infantil/bebê/gestante');
  });
});

describe('ehAbstencaoDeliberada', () => {
  it('literal JSON null → true', () => {
    expect(ehAbstencaoDeliberada(null)).toBe(true);
  });
  it('string "null" (achado empírico: gpt-4o-mini devolve isso, não o literal) → true', () => {
    expect(ehAbstencaoDeliberada('null')).toBe(true);
    expect(ehAbstencaoDeliberada('NULL')).toBe(true);
    expect(ehAbstencaoDeliberada(' null ')).toBe(true);
  });
  it('category_id válido → false', () => {
    expect(ehAbstencaoDeliberada('MLB430376')).toBe(false);
  });
  it('undefined → false (não é abstenção, é ausência — tratado como falha técnica em outro lugar)', () => {
    expect(ehAbstencaoDeliberada(undefined)).toBe(false);
  });
});
