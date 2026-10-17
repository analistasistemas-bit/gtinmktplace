import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CategoriaCandidata } from '../../ml/domain-discovery';

// client.ts importa 'npm:openai@^4' (não resolve no vitest) — mesmo mock de copywriter-slots.test.ts,
// aqui com um create fake que registra o prompt recebido.
const prompts: string[] = [];
vi.mock('../client.ts', () => ({
  openrouterClient: () => ({
    chat: { completions: { create: async (req: { messages: { role: string; content: string }[] }) => {
      prompts.push(req.messages.find((m) => m.role === 'user')!.content);
      return { choices: [{ message: { content: '{"category_id":"MLB188064"}' } }] };
    } } },
  }),
}));

import { desempatarCategoriaLLM } from '../categoria-llm';

const shorts: CategoriaCandidata[] = [
  { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB188064', categoriaNome: 'Bermudas e Shorts' },
  { domainId: 'MLB-SHORTS', domainName: 'Shorts', categoriaId: 'MLB278065', categoriaNome: 'Shorts' },
];

beforeEach(() => { prompts.length = 0; });

describe('desempatarCategoriaLLM — enriquecimento com caminho', () => {
  it('passa os caminhos e o gênero ao prompt', async () => {
    const r = await desempatarCategoriaLLM({ nome: 'Short', genero: 'masculino' }, shorts, 'm', undefined,
      async () => ({ MLB278065: 'Bebês > Roupas de Bebê > Shorts' }));
    expect(r).toBe('MLB188064');
    expect(prompts[0]).toContain('MLB278065 — Bebês > Roupas de Bebê > Shorts');
    expect(prompts[0]).toContain('MLB188064 — Shorts > Bermudas e Shorts');
    expect(prompts[0]).toContain('Gênero: Masculino (adulto)');
  });

  it('falha ao buscar caminhos não suprime o LLM (sai como hoje, domínio > folha)', async () => {
    const r = await desempatarCategoriaLLM({ nome: 'Short' }, shorts, 'm', undefined,
      async () => { throw new Error('rede'); });
    expect(r).toBe('MLB188064');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('MLB278065 — Shorts > Shorts');
  });
});
