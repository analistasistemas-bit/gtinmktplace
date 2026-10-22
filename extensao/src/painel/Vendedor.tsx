// Bloco "Vendedor" (ADR-0189 D-10): perfil público de /users. `vendas` é transactions.total, janela móvel de
// ~365 dias (ADR-0142): só mostra período quando o ML o informa em dias; senão rótulo neutro.
import type { VendedorML } from '../../../supabase/functions/_shared/extensao/tipos.ts';

const REPUTACAO: Record<string, { texto: string; cor: string }> = {
  '5_green': { texto: 'Verde', cor: 'verde' },
  '4_light_green': { texto: 'Verde-claro', cor: 'verde' },
  '3_yellow': { texto: 'Amarela', cor: 'amarelo' },
  '2_orange': { texto: 'Laranja', cor: 'amarelo' },
  '1_red': { texto: 'Vermelha', cor: 'vermelho' },
};

const MEDALHA: Record<string, string> = {
  platinum: 'MercadoLíder Platinum',
  gold: 'MercadoLíder Gold',
  silver: 'MercadoLíder',
};

export function Vendedor({ vendedor: v }: { vendedor: VendedorML }) {
  const rep = v.nivel ? REPUTACAO[v.nivel] : undefined;
  const medalha = v.medalha ? MEDALHA[v.medalha] : undefined;
  return (
    <section className="cartao quanto-vende vendedor" aria-labelledby="vd-titulo">
      <div className="qv-cabeca">
        <h2 id="vd-titulo">Vendedor</h2>
        {v.uf && <span className="observado">{v.uf}</span>}
      </div>
      {v.nickname && <p className="vd-nome">{v.nickname}</p>}
      <dl className="qv-numeros">
        <div>
          <dt>Reputação</dt>
          <dd>
            {rep ? (
              <><span className={`ponto ${rep.cor}`} title={`Reputação ${v.nivel}`} />{rep.texto}</>
            ) : 'Sem reputação'}
          </dd>
        </div>
        <div>
          <dt>{v.periodo ? `Vendas nos ${v.periodo}` : 'Vendas'}</dt>
          <dd className="mono">{v.vendas.toLocaleString('pt-BR')}</dd>
        </div>
      </dl>
      {medalha && <p className="nota">{medalha}</p>}
    </section>
  );
}
