// Bloco "Vendedor" (ADR-0189 D-10): perfil público de /users. `vendas` é transactions.total, janela móvel de
// ~365 dias (ADR-0142): só mostra período quando o ML o informa em dias; senão rótulo neutro.
import type { VendedorML } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { REPUTACAO } from './formato';


const MEDALHA: Record<string, string> = {
  platinum: 'MercadoLíder Platinum',
  gold: 'MercadoLíder Gold',
  silver: 'MercadoLíder',
};

export function Vendedor({ vendedor: v, lojaOficial }: { vendedor: VendedorML; lojaOficial?: { nome: string | null } | null }) {
  // Loja oficial vem da página do anúncio (pdp.ts, caminhos medidos); nome só quando acrescenta algo ao apelido.
  const nomeLoja = lojaOficial?.nome && lojaOficial.nome.toLowerCase() !== v.nickname?.toLowerCase() ? lojaOficial.nome : null;
  const rep = v.nivel ? REPUTACAO[v.nivel] : undefined;
  const medalha = v.medalha ? MEDALHA[v.medalha] : undefined;
  return (
    <section className="cartao quanto-vende vendedor" aria-labelledby="vd-titulo">
      <div className="qv-cabeca">
        <h2 id="vd-titulo">Vendedor</h2>
        {v.uf && <span className="observado">{v.uf}</span>}
      </div>
      {v.nickname && <p className="vd-nome">{v.nickname}</p>}
      {lojaOficial && <p className="vd-loja">{nomeLoja ? `Loja oficial ${nomeLoja}` : 'Loja oficial'}</p>}
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
