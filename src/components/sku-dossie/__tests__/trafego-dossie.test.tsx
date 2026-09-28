import { cloneElement, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TrafegoDossie } from '../trafego-dossie';
import type { PontoTrafego, TrafegoDossie as Trafego } from '@/lib/sku-trafego';

// Em jsdom o ResponsiveContainer fica 0x0 e não desenha nada: tamanho fixo para o SVG existir.
vi.mock('recharts', async (orig) => ({
  ...(await orig<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 240 } as never),
}));

const iv = (rotulo: string, inicio: string) => ({ inicio, fim: inicio, rotulo, incompleto: false, inicioParcial: false });
const EST = { ok: 7, pendente: 0, falha: 0, ausente: 0, nao_coletado: 0 };
const pt = (rotulo: string, inicio: string, visitas: number | null): PontoTrafego => ({
  intervalo: iv(rotulo, inicio), visitas, unidades: 0, unidadesPorVisita: visitas ? 0 : null, precoObservado: null,
  estados: visitas == null ? { ...EST, ok: 5, falha: 2 } : EST,
});

describe('TrafegoDossie: zero medido × lacuna', () => {
  it('semana com 0 visitas medidas vira anel; semana sem dado continua lacuna', () => {
    const t: Trafego = {
      calendario: 'brt', alcance: 'sku', estadoColeta: 'ok', motivo: null, coberturaDesde: '2026-08-24', precoAtual: null,
      porMlb: [{ mlb: 'MLB1', vinculo: 'exato', codigos: ['01267221'], considerado: true }],
      serie: [
        pt('24/08', '2026-08-24T03:00:00.000Z', 12),
        pt('31/08', '2026-08-31T03:00:00.000Z', 0),
        pt('07/09', '2026-09-07T03:00:00.000Z', 0),
        pt('14/09', '2026-09-14T03:00:00.000Z', null),
      ],
    };
    render(<TrafegoDossie trafego={t} familia={false} passo="semana" onPasso={vi.fn()} onTentar={vi.fn()} />);
    expect(screen.getAllByTestId('zero-visitas')).toHaveLength(2);
    expect(screen.getByText('0 visitas medidas')).toBeInTheDocument();
  });
});
