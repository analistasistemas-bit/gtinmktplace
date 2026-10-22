// "Minha margem" no painel (ADR-0189 D-7/D-8). Recalcula localmente com os `parametros` da última
// análise; confirma no servidor 1,5 s depois que o operador para de editar o preço (D-18).
import { useEffect, useRef, useState } from 'react';
import type { Disponivel, MargemTipo } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { calcularMinhaMargem } from '../compartilhado/margem';
import { brl, mensagemDeErro, pct, ROTULO_FONTE, type EntradaAnuncio, type Resposta, type RespostaAnuncio } from './formato';

const ESPERA_CONFIRMAR_MS = 1500;
type Origem = 'nacional' | 'importado';

interface Props {
  entrada: EntradaAnuncio;
  dados: RespostaAnuncio;
  /** Nova análise do mesmo anúncio a outro preço. */
  analisar: (preco: number) => Promise<Resposta<RespostaAnuncio>>;
  onDados: (dados: RespostaAnuncio) => void;
}

/** Texto do input → número, ou null quando vazio/inválido (nunca NaN na tela). */
function numero(txt: string): number | null {
  if (txt.trim() === '') return null;
  const n = Number(txt.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function MinhaMargem({ entrada, dados, analisar, onDados }: Props) {
  const [precoTxt, setPrecoTxt] = useState(String(entrada.preco));
  const [custoTxt, setCustoTxt] = useState('');
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const precoN = numero(precoTxt);
  const preco = precoN !== null && precoN > 0 ? precoN : null;

  function editarPreco(txt: string) {
    setPrecoTxt(txt);
    setErro(null);
    clearTimeout(timer.current);
    const n = ++seq.current; // descarta resposta de preço anterior
    const p = numero(txt);
    if (p === null || p <= 0) return;
    timer.current = setTimeout(async () => {
      const r = await analisar(p);
      if (n !== seq.current) return;
      if (r.ok) onDados(r.dados);
      else setErro(mensagemDeErro(r.erro));
    }, ESPERA_CONFIRMAR_MS);
  }

  const { custo, parametros } = dados;
  const semVinculo = custo.fonte === 'nenhuma';
  const custoN = numero(custoTxt);
  const custoDigitado = custoN !== null && custoN >= 0 ? custoN : null;
  const origemEfetiva: Origem | null = semVinculo ? origem : custo.origem;

  let pendencia: string | null = null;
  if (preco === null) pendencia = 'Informe um preço válido.';
  else if (semVinculo && custoDigitado === null) pendencia = origem ? 'Informe o custo do pacote para calcular.' : 'Informe o custo do pacote e a origem para calcular.';
  else if (semVinculo && !origem) pendencia = 'Escolha a origem (Nacional ou Importado) para calcular.';

  let margem = null;
  if (pendencia === null && preco !== null) {
    const { aliquotas } = parametros;
    // Origem nunca presumida (D-8); alíquota só confirmada (D-7). Mesma regra da edge.
    const aliquotaPct: Disponivel<number> = !aliquotas.confirmada
      ? { estado: 'indisponivel', motivo: 'Confirme as alíquotas de imposto em Configurações' }
      : origemEfetiva === null
        ? { estado: 'indisponivel', motivo: 'Informe a origem do produto' }
        : { estado: 'ok', valor: origemEfetiva === 'importado' ? aliquotas.importado ?? 16 : aliquotas.nacional ?? 8 };
    margem = calcularMinhaMargem({
      preco,
      aliquotaPct,
      custoPacote: semVinculo ? { estado: 'ok', valor: custoDigitado! } : custo.custoPacote,
      classico: { comissao: parametros.classico, frete: parametros.frete },
      premium: { comissao: parametros.premium, frete: parametros.frete },
    });
  }
  const precoConfirmado = dados.margem?.preco ?? entrada.preco;

  return (
    <section className="bloco">
      <h2>Minha margem</h2>
      <label className="campo">
        Preço (R$)
        <input type="number" inputMode="decimal" min="0" step="0.01" value={precoTxt} onChange={(e) => editarPreco(e.target.value)} />
      </label>
      {preco !== null && preco !== precoConfirmado && (
        <p className="nota">Simulação: o frete pode mudar após a confirmação (faixas de frete grátis do Mercado Livre).</p>
      )}
      {erro && <p className="erro" role="alert">{erro}</p>}

      {semVinculo ? (
        <div className="custo">
          <label className="campo">
            Custo do pacote (R$)
            <input type="number" inputMode="decimal" min="0" step="0.01" value={custoTxt} onChange={(e) => setCustoTxt(e.target.value)} />
          </label>
          <fieldset className="origem">
            <legend>Origem</legend>
            {(['nacional', 'importado'] as const).map((o) => (
              <label key={o}>
                <input type="radio" name="origem" value={o} checked={origem === o} onChange={() => setOrigem(o)} />
                {o === 'nacional' ? 'Nacional' : 'Importado'}
              </label>
            ))}
          </fieldset>
        </div>
      ) : (
        <div className="custo">
          <p>{`Custo do SKU ${custo.codigo ?? '—'} · ${ROTULO_FONTE[custo.fonte] ?? custo.fonte}`}</p>
          <p className="nota">
            {custo.custoPacote?.estado === 'ok'
              ? `Custo do pacote: ${brl(custo.custoPacote.valor)}${custo.unidadesPorPacote > 1 ? ` (${custo.unidadesPorPacote} unidades)` : ''}`
              : `Custo do pacote indisponível: ${custo.custoPacote?.motivo ?? 'sem custo'}`}
          </p>
        </div>
      )}

      {pendencia && <p className="aviso">{pendencia}</p>}
      {margem && (
        <div className="tipos">
          <Tipo nome="Clássico" r={margem.classico} />
          <Tipo nome="Premium" r={margem.premium} />
        </div>
      )}
    </section>
  );
}

function Tipo({ nome, r }: { nome: string; r: Disponivel<MargemTipo> }) {
  const id = `tipo-${nome}`;
  return (
    <section className="tipo" aria-labelledby={id}>
      <h3 id={id}>{nome}</h3>
      {r.estado === 'indisponivel' ? (
        <p className="aviso">Indisponível: {r.motivo}</p>
      ) : (
        <>
          <dl>
            <dt>Comissão</dt><dd>{brl(r.valor.comissao)}</dd>
            <dt>Imposto</dt><dd>{brl(r.valor.imposto)}</dd>
            <dt>Frete</dt><dd>{brl(r.valor.frete)}</dd>
            <dt>Recebe</dt><dd>{brl(r.valor.recebe)}</dd>
            <dt>Custo</dt><dd>{r.valor.custo === null ? '—' : brl(r.valor.custo)}</dd>
            <dt>Lucro</dt><dd>{r.valor.lucro === null ? '—' : brl(r.valor.lucro)}</dd>
            <dt>Margem</dt><dd>{r.valor.margemPct === null ? '—' : pct(r.valor.margemPct)}</dd>
          </dl>
          {r.valor.avisos.length > 0 && (
            <ul className="avisos">{r.valor.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
          )}
        </>
      )}
    </section>
  );
}
