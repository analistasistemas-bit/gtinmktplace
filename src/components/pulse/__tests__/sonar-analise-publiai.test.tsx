import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RespostaSecoes237Sonar } from '@/lib/sonar';
import { SonarAnalisePubliAI } from '../sonar-analise-publiai';

function resposta(over: Partial<RespostaSecoes237Sonar['secoes237']> = {}): RespostaSecoes237Sonar {
  return {
    secoes237: {
      '2.6': {
        estado: 'valor',
        faturamento_mes: 12_345,
        vendedores_com_estimativa: 5,
        vendedores_distintos: 8,
        rotulo: 'faturamento de 5 vendedores com estimativa',
      },
      '2.9': { parecer: 'nicho pequeno para a meta' },
      '3.2': {
        estado: 'valor',
        vendas_mes_mediana: 21,
        vendedores_com_estimativa: 5,
        rotulo: 'mediana de vendas/mês',
      },
      '3.3': {
        com_estimativa: 5,
        vendedores_distintos: 8,
        proporcao: 5 / 8,
        anuncios_na_amostra: 113,
        anuncios_cobertos: 5,
        proporcao_anuncios: 5 / 113,
        rotulo: '5 de 113 anúncios da amostra cobertos — 5 de 8 vendedores com estimativa mensal',
      },
      '3.4': { contagem: 3, rotulo: '3 vendedores sem estimativa mensal' },
      limitacao_3_2: 'loja inteira do vendedor',
      '7.4': null,
      ...over,
    },
    meta: { vendedores_distintos: 8, sem_seller_id: 108, serie_linhas: 40, anuncios_na_amostra: 113 },
  };
}

const render237 = (data: RespostaSecoes237Sonar) =>
  render(<SonarAnalisePubliAI data={data} carregando={false} erro={null} />);

describe('SonarAnalisePubliAI — cobertura honesta (spike 045)', () => {
  it('o percentual acompanha os anúncios, não a contagem de vendedores', () => {
    render237(resposta());
    // Uma linha para cada unidade; o % nunca fica colado na cláusula de vendedores.
    const anuncios = screen.getByText(/anúncios da amostra cobertos/);
    expect(anuncios.textContent).toContain('5 de 113');
    expect(anuncios.textContent).toContain('4%');
    expect(anuncios.textContent).not.toContain('vendedores');

    const vendedores = screen.getByText(/vendedores com estimativa mensal/);
    expect(vendedores.textContent).toContain('5 de 8');
    expect(vendedores.textContent).not.toMatch(/\d+%/);
  });

  it('3.4 fica junto da linha de vendedores — mesmo denominador', () => {
    render237(resposta());
    const vendedores = screen.getByText(/vendedores com estimativa mensal/);
    // 5 com estimativa + 3 sem = os 8 vendedores resolvidos.
    expect(vendedores.textContent).toContain('3 sem estimativa');
  });

  it('sem faturamento ainda mostra a cobertura — o operador precisa saber por quê', () => {
    render237(resposta({
      '2.6': {
        estado: 'sem_dado',
        mensagem: 'amostra insuficiente: 1 de 5 vendedores mínimos com estimativa mensal',
      },
    }));
    expect(screen.getByText(/amostra insuficiente: 1 de 5/)).toBeInTheDocument();
    expect(screen.getByText(/anúncios da amostra cobertos/).textContent).toContain('5 de 113');
  });

  it('não repete a contagem de anúncios sem seller_id em rodapé', () => {
    render237(resposta());
    expect(screen.queryByText(/sem seller_id identificado/)).toBeNull();
  });
});
