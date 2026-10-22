// Bloco "Quanto vende · Observado" (ADR-0189 D-6/D-9 + emenda 2026-10-22): faixa pública, idade (semáforo de
// D-10) e mínimo por mês. Sem estimativa aqui — ela só entra depois de validada (Task 13).
import { quantoVende } from '../compartilhado/quanto-vende';

export interface Observado { vendidosTexto: string | null; criadoEm: string | null }

const num = (n: number) => n.toLocaleString('pt-BR');

export function QuantoVende({ observado, catalogo, agora }: { observado: Observado; catalogo: boolean; agora?: Date }) {
  const q = quantoVende({ ...observado, catalogo }, agora);
  if (q.piso === null && q.dias === null) return null;
  return (
    <section className="cartao quanto-vende" aria-labelledby="qv-titulo">
      <div className="qv-cabeca">
        <h2 id="qv-titulo">Quanto vende</h2>
        <span className="observado">Observado</span>
      </div>
      <dl className="qv-numeros">
        <div>
          <dt>Vendidos</dt>
          <dd className="mono">{q.piso === null ? '—' : `+${num(q.piso)}`}</dd>
        </div>
        {q.dias !== null && (
          <div>
            <dt>Criado há</dt>
            <dd className="mono">
              <span className={`ponto ${q.semaforo}`} title={`Criado em ${new Date(q.criadoEm!).toLocaleDateString('pt-BR')}`} />
              {`${num(q.dias)} dias`}
            </dd>
          </div>
        )}
        {q.minimoPorMes !== null && (
          <div>
            <dt>Mínimo</dt>
            <dd className="mono">{`≥ ${num(q.minimoPorMes)}/mês`}</dd>
          </div>
        )}
      </dl>
      {q.dias === null && <p className="nota">Data de criação indisponível. Entre no Mercado Livre neste navegador para vê-la.</p>}
    </section>
  );
}
