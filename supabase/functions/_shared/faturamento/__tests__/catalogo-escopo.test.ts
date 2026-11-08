import { describe, it, expect } from 'vitest';
import { carregarCatalogo } from '../io';

/**
 * Incidente 2026-08-11 (org DSA): `carregarCatalogo` filtrava `familias`/`variacoes` por
 * `user_id` — o `criado_por` da conexão do canal. Produto cadastrado por OUTRO membro da mesma
 * org ficava fora do catálogo, a venda vinha com `is_publiai = false` e SEM código, e a baixa
 * de estoque descartava o item em silêncio: 12 unidades venderam sem baixar nada.
 *
 * O fake registra os filtros aplicados por tabela — é exatamente isso que o teste protege.
 */
function criarAdminFake(conexao: { org_id: string } | null) {
  const filtros: Array<{ tabela: string; coluna: string; valor: string }> = [];

  function query(tabela: string) {
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: (coluna: string, valor: string) => {
        filtros.push({ tabela, coluna, valor });
        return alvo;
      },
      range: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: conexao, error: null }),
    };
    return alvo;
  }

  return { filtros, from: (tabela: string) => query(tabela) };
}

const ORG = 'org-1111';
const USER = 'user-2222';

/** `variacoes` responde uma página cheia e erra na seguinte. */
function adminComFalhaNaPagina2() {
  let chamadas = 0;
  const query = (tabela: string) => {
    const alvo = {
      select: () => alvo,
      not: () => alvo,
      eq: () => alvo,
      range: () => {
        if (tabela !== 'variacoes') return Promise.resolve({ data: [], error: null });
        chamadas += 1;
        return Promise.resolve(chamadas === 1
          ? { data: Array.from({ length: 1000 }, () => ({ familia_id: 'f', codigo: 'SKU' })), error: null }
          : { data: null, error: { message: 'timeout na página 2' } });
      },
    };
    return alvo;
  };
  return { from: query };
}

describe('carregarCatalogo — estrito', () => {
  it('sucesso seguido de falha lança no modo estrito', async () => {
    await expect(carregarCatalogo(adminComFalhaNaPagina2() as never, USER, ORG, { estrito: true }))
      .rejects.toThrow('timeout na página 2');
  });

  it('sem o modo estrito segue tolerante, para os chamadores atuais', async () => {
    await expect(carregarCatalogo(adminComFalhaNaPagina2() as never, USER, ORG)).resolves.toBeDefined();
  });
});

// ADR-0199 (Task 8): o sync-venda segue tolerante, mas precisa saber que o catálogo veio incompleto para
// não gerar outra referência de baixa num SKU participante.
describe('carregarCatalogo — incompleto e módulo de kit', () => {
  function admin(o: { falha?: boolean; modulos?: string[] | null; erroModulo?: boolean }) {
    const tabelas: string[] = [];
    const query = (tabela: string) => {
      tabelas.push(tabela);
      const alvo = {
        select: () => alvo,
        not: () => alvo,
        eq: () => alvo,
        range: () => {
          if (tabela === 'familias') {
            return Promise.resolve({
              data: o.modulos === null ? [] : [{ id: 'f', ml_item_id: 'MLB1', codigo_pai: 'P', organizations: { modulos_habilitados: o.modulos ?? [] } }],
              error: null,
            });
          }
          if (tabela === 'variacoes' && o.falha) return Promise.resolve({ data: null, error: { message: 'timeout' } });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle: () => Promise.resolve(o.erroModulo
          ? { data: null, error: { message: 'x' } }
          : { data: { modulos_habilitados: ['kit_variacao'] }, error: null }),
      };
      return alvo;
    };
    return { tabelas, from: query };
  }

  it('leitura completa: módulo vem embutido em familias, sem consulta nova', async () => {
    const a = admin({ modulos: ['kit_variacao'] });
    const c = await carregarCatalogo(a as never, USER, ORG);
    expect(c.incompleto).toBe(false);
    expect(c.kitLigado).toBe(true);
    expect(a.tabelas).not.toContain('organizations');
  });

  it('org sem módulo, leitura completa: desligado e sem consulta nova', async () => {
    const a = admin({ modulos: [] });
    const c = await carregarCatalogo(a as never, USER, ORG);
    expect(c).toMatchObject({ incompleto: false, kitLigado: false });
    expect(a.tabelas).not.toContain('organizations');
  });

  it('página com erro marca incompleto e lê o módulo só nesse caminho', async () => {
    const a = admin({ falha: true, modulos: null });
    const c = await carregarCatalogo(a as never, USER, ORG);
    expect(c).toMatchObject({ incompleto: true, kitLigado: true });
    expect(a.tabelas).toContain('organizations');
  });

  it('incompleto e módulo ilegível: trata como ligado (conservador)', async () => {
    const c = await carregarCatalogo(admin({ falha: true, modulos: null, erroModulo: true }) as never, USER, ORG);
    expect(c.kitLigado).toBe(true);
  });
});

describe('carregarCatalogo — escopo', () => {
  it('filtra famílias e variações por org_id quando há conexão', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);

    const familias = admin.filtros.filter((f) => f.tabela === 'familias');
    const variacoes = admin.filtros.filter((f) => f.tabela === 'variacoes');
    expect(familias).toEqual([{ tabela: 'familias', coluna: 'org_id', valor: ORG }]);
    expect(variacoes).toEqual([{ tabela: 'variacoes', coluna: 'org_id', valor: ORG }]);
  });

  it('nunca filtra o catálogo por user_id quando a org foi resolvida', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);
    const porUsuario = admin.filtros.filter(
      (f) => f.coluna === 'user_id' && (f.tabela === 'familias' || f.tabela === 'variacoes'),
    );
    expect(porUsuario).toEqual([]);
  });

  // Sem conexão não há org para resolver. Cair para o comportamento antigo é melhor que
  // devolver catálogo vazio, que faria TODA venda parecer de terceiro.
  it('cai para user_id quando não há conexão do canal', async () => {
    const admin = criarAdminFake(null);
    await carregarCatalogo(admin as never, USER);

    const familias = admin.filtros.filter((f) => f.tabela === 'familias');
    expect(familias).toEqual([{ tabela: 'familias', coluna: 'user_id', valor: USER }]);
  });

  it('resolve a org uma vez só, não uma por consulta', async () => {
    const admin = criarAdminFake({ org_id: ORG });
    await carregarCatalogo(admin as never, USER);
    const conexoes = admin.filtros.filter((f) => f.tabela === 'marketplace_connections');
    // canal + criado_por = 2 filtros de UMA única resolução.
    expect(conexoes).toHaveLength(2);
  });
});
