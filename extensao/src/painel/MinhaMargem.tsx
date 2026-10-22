// "Minha margem" no painel (ADR-0189 D-7/D-8). Recalcula localmente com os `parametros` da última
// análise; confirma no servidor 1,5 s depois que o operador para de editar o preço (D-18).
import { useEffect, useRef, useState } from 'react';
import type { Disponivel, MargemTipo } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { calcularMinhaMargem, custoDoPacote, fatorDoPacote } from '../compartilhado/margem';
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
  // Unidades confirmadas pelo operador valem só para o SKU em que foram digitadas (troca de vínculo → vazias).
  const [unidades, setUnidades] = useState({ sku: dados.custo.variacaoId, anuncio: '', noSku: '' });
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
  const custoDigitado = custoN !== null && custoN > 0 ? custoN : null; // 0 = não cadastrado, igual à edge (custoDe)
  const origemEfetiva: Origem | null = semVinculo ? origem : custo.origem;
  const daquiSku = unidades.sku === custo.variacaoId ? unidades : { sku: custo.variacaoId, anuncio: '', noSku: '' };
  const unidadesTxt = daquiSku.anuncio;
  const unidadesSkuTxt = daquiSku.noSku;
  const setUnidadesTxt = (anuncio: string) => setUnidades({ ...daquiSku, anuncio });
  const setUnidadesSkuTxt = (noSku: string) => setUnidades({ ...daquiSku, noSku });
  // Unidades não confirmadas (D-8): o operador informa o lado que falta (anúncio e/ou SKU); sem padrão.
  const falta = semVinculo ? null : custo.faltaUnidades;
  const pedeAnuncio = falta === 'anuncio' || falta === 'ambos';
  const pedeSku = falta === 'sku' || falta === 'ambos';
  const inteiro = (txt: string) => { const n = numero(txt); return n !== null && Number.isInteger(n) && n >= 1 ? n : null; };
  const anuncioDigitado = pedeAnuncio ? inteiro(unidadesTxt) : null;
  const skuDigitado = pedeSku ? inteiro(unidadesSkuTxt) : null;
  const recalcula = anuncioDigitado !== null || skuDigitado !== null;
  const composicao = recalcula
    ? fatorDoPacote(pedeAnuncio ? anuncioDigitado : custo.unidadesPorPacote, pedeSku ? skuDigitado : custo.unidadesSku)
    : null;
  const fator = composicao ? (composicao.estado === 'ok' ? composicao.valor : null) : custo.fator;
  const custoPacote = composicao ? custoDoPacote(custo.custoSku, composicao) : custo.custoPacote;

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
        ? { estado: 'indisponivel', motivo: semVinculo ? 'Informe a origem do produto' : 'SKU sem origem cadastrada' }
        : { estado: 'ok', valor: origemEfetiva === 'importado' ? aliquotas.importado ?? 16 : aliquotas.nacional ?? 8 };
    margem = calcularMinhaMargem({
      preco,
      aliquotaPct,
      custoPacote: semVinculo ? { estado: 'ok', valor: custoDigitado! } : custoPacote,
      classico: { comissao: parametros.classico, frete: parametros.frete },
      premium: { comissao: parametros.premium, frete: parametros.frete },
    });
  }
  const precoConfirmado = dados.margem?.preco ?? entrada.preco;
  // Comissão (faixa) e frete vêm da última consulta confirmada: a outro preço, o resultado inteiro é estimativa
  // até o servidor confirmar — e continua sendo se a confirmação falhar (dados não mudam).
  const estimativa = preco !== null && preco !== precoConfirmado;

  return (
    <section className="bloco">
      <h2>Minha margem</h2>
      <label className="campo">
        Preço (R$)
        <input type="number" inputMode="decimal" min="0" step="0.01" value={precoTxt} onChange={(e) => editarPreco(e.target.value)} />
      </label>
      {estimativa && (
        <p className="nota">Estimativa: a comissão e o frete são do preço consultado e podem mudar de faixa neste preço até a confirmação no Mercado Livre.</p>
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
          {pedeAnuncio && (
            <label className="campo">
              Unidades por anúncio
              <input type="number" inputMode="numeric" min="1" step="1" value={unidadesTxt} onChange={(e) => setUnidadesTxt(e.target.value)} />
            </label>
          )}
          {pedeSku && (
            <label className="campo">
              Unidades no SKU
              <input type="number" inputMode="numeric" min="1" step="1" value={unidadesSkuTxt} onChange={(e) => setUnidadesSkuTxt(e.target.value)} />
            </label>
          )}
          <p className="nota">
            {custoPacote?.estado === 'ok'
              ? `Custo do pacote: ${brl(custoPacote.valor)}${fator !== null && fator > 1 ? ` (${fator} × custo do SKU)` : ''}`
              : `Custo do pacote indisponível: ${custoPacote?.motivo ?? 'sem custo'}`}
          </p>
        </div>
      )}

      {pendencia && <p className="aviso">{pendencia}</p>}
      {margem && (
        <div className="tipos">
          <Tipo nome="Clássico" r={margem.classico} estimativa={estimativa} />
          <Tipo nome="Premium" r={margem.premium} estimativa={estimativa} />
        </div>
      )}
    </section>
  );
}

function Tipo({ nome, r, estimativa }: { nome: string; r: Disponivel<MargemTipo>; estimativa: boolean }) {
  const id = `tipo-${nome}`;
  return (
    <section className="tipo" aria-labelledby={id}>
      <h3 id={id}>{nome}</h3>
      {estimativa && <p className="aviso">Estimativa</p>}
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
