// Bloco "Catálogo" (ADR-0189 D-12, Task 24): participação da org, vencedor informado pelo ML, resumo, ofertas e
// distribuição dos vendedores. Carrega sozinho só em /p/; nas demais páginas, por clique (custo: 1 análise + perfis).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { OfertaCatalogo, RespostaCatalogo } from '../../../supabase/functions/_shared/extensao/catalogo.ts';
import type { Disponivel } from '../../../supabase/functions/_shared/extensao/tipos.ts';
import { brl, mensagemDeErro, REPUTACAO, URL_APP, type Chamar } from './formato';

type Ordem = 'preco' | 'reputacao' | 'medalha';
type Estado =
  | { tipo: 'ocioso' } | { tipo: 'carregando' }
  | { tipo: 'ok'; dados: RespostaCatalogo }
  | { tipo: 'indisponivel'; motivo: string }
  | { tipo: 'erro'; mensagem: string };

const LINHAS = 5;
const NIVEL: Record<string, number> = { '5_green': 5, '4_light_green': 4, '3_yellow': 3, '2_orange': 2, '1_red': 1 };
const MEDALHA: Record<string, { peso: number; nome: string }> = {
  platinum: { peso: 3, nome: 'Platinum' }, gold: { peso: 2, nome: 'Gold' }, silver: { peso: 1, nome: 'MercadoLíder' },
};
const PTW: Record<string, string> = {
  winning: 'Você está ganhando',
  sharing_first_place: 'Dividindo o 1º lugar',
  competing: 'Para ganhar',
  listed: 'Fora da disputa',
};
const num = (n: number) => n.toLocaleString('pt-BR');

// Desconhecido no fim, preço desempata (consultor, 22/10).
function ordenar(ofertas: OfertaCatalogo[], ordem: Ordem): OfertaCatalogo[] {
  if (ordem === 'preco') return ofertas;
  const peso = (o: OfertaCatalogo) => {
    if (!o.vendedor) return -2;
    if (ordem === 'reputacao') return o.vendedor.nivel ? NIVEL[o.vendedor.nivel] ?? -1 : -1;
    return o.vendedor.medalha ? MEDALHA[o.vendedor.medalha]?.peso ?? 0 : 0;
  };
  return [...ofertas].sort((a, b) => peso(b) - peso(a) || a.preco - b.preco);
}

function Barras({ titulo, itens, total }: { titulo: string; itens: { rotulo: string; n: number; neutro?: boolean }[]; total: number }) {
  return (
    <div className="ct-barras">
      <h3 className="qv-sub">{titulo}</h3>
      <ul aria-label={titulo}>
        {itens.map((i) => (
          <li key={i.rotulo} className={i.neutro ? 'neutro' : undefined}>
            <span className="ct-barra-rotulo">{i.rotulo}</span>
            <span className="ct-barra-trilho" aria-hidden="true"><span style={{ width: `${total ? (i.n / total) * 100 : 0}%` }} /></span>
            <span className="ct-barra-n mono">{num(i.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Catalogo({ entrada, chamar, onSimular }: {
  entrada: { tipoPagina?: string; mlItemId: string; catalogProductId: string };
  chamar: Chamar;
  onSimular: (preco: number) => void;
}) {
  const naP = entrada.tipoPagina === 'catalogo';
  const [estado, setEstado] = useState<Estado>(naP ? { tipo: 'carregando' } : { tipo: 'ocioso' });
  const [ordem, setOrdem] = useState<Ordem>('preco');
  const [todas, setTodas] = useState(false);
  const nomeOrdem = useId();
  // Só a última requisição vale (StrictMode monta o efeito duas vezes; clique repetido; desmonte com carga no ar).
  // Troca de catálogo/página/item remonta o bloco pela `key` no App.
  const seq = useRef(0);
  useEffect(() => () => { seq.current++; }, []);

  const carregar = useCallback(async () => {
    const n = ++seq.current;
    setEstado({ tipo: 'carregando' });
    // Item da página só em /p/: lá o evento da página é a buy box; em item/up o item aberto não é o vencedor.
    const r = await chamar<Disponivel<RespostaCatalogo>>({ acao: 'catalogo', catalogProductId: entrada.catalogProductId, itemDaPagina: naP ? entrada.mlItemId : null });
    if (n !== seq.current) return;
    if (!r.ok) setEstado({ tipo: 'erro', mensagem: r.erro === 'limite' ? mensagemDeErro('limite') : 'Não foi possível carregar o catálogo.' });
    else if (r.dados.estado === 'indisponivel') setEstado({ tipo: 'indisponivel', motivo: r.dados.motivo });
    else setEstado({ tipo: 'ok', dados: r.dados.valor });
  }, [chamar, entrada.catalogProductId, entrada.mlItemId, naP]);

  useEffect(() => { if (naP) void carregar(); }, [naP, carregar]);

  const cabeca = (selo?: string) => (
    <div className="qv-cabeca">
      <h2 id="ct-titulo">Catálogo</h2>
      {selo && <span className="observado">{selo}</span>}
    </div>
  );

  if (estado.tipo === 'ocioso') {
    return (
      <section className="cartao quanto-vende catalogo" aria-labelledby="ct-titulo">
        {cabeca()}
        <p className="nota">Este anúncio está num catálogo. Veja quem vende, quem ganha e onde você fica.</p>
        <button type="button" className="secundario" onClick={carregar}>Ver ofertas do catálogo</button>
      </section>
    );
  }
  if (estado.tipo === 'carregando') {
    return (
      <section className="cartao quanto-vende catalogo" aria-labelledby="ct-titulo" aria-busy="true">
        {cabeca()}
        <div className="esqueleto ct-esqueleto" role="status" aria-label="Carregando ofertas e vendedores"><span /><span /><span /></div>
        <p className="nota">Carregando ofertas e vendedores…</p>
      </section>
    );
  }
  if (estado.tipo !== 'ok') {
    // Sem conexão ML não se resolve tentando de novo; falha temporária do ML sim.
    const semConexao = estado.tipo === 'indisponivel' && /conecte/i.test(estado.motivo);
    return (
      <section className="cartao quanto-vende catalogo" aria-labelledby="ct-titulo">
        {cabeca()}
        <p className="nota" role={estado.tipo === 'erro' ? 'alert' : undefined}>{estado.tipo === 'erro' ? estado.mensagem : estado.motivo}</p>
        {semConexao
          ? <a className="botao" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir o PubliAI</a>
          : <button type="button" className="secundario" onClick={carregar}>Tentar de novo</button>}
      </section>
    );
  }

  const d = estado.dados;
  const parcial = !d.leitura.completa;
  const selo = !parcial ? `${num(d.leitura.carregadas)} ofertas`
    : d.leitura.total !== null ? `Parcial: ${num(d.leitura.carregadas)} de ${num(d.leitura.total)}` : `Parcial: ${num(d.leitura.carregadas)} carregadas`;
  const ordenadas = ordenar(d.ofertas, ordem);
  const visiveis = todas ? ordenadas : ordenadas.slice(0, LINHAS);
  const p = d.participacao;
  const vencedor = d.vencedor ? d.ofertas.find((o) => o.itemId === d.vencedor!.itemId) : undefined;

  // UF: top 5 + Outras + Não informado (vendedores únicos).
  const ufs = Object.entries(d.resumo.porUf).filter(([uf]) => uf !== 'nao_informado').sort((a, b) => b[1] - a[1]);
  const outras = ufs.slice(5).reduce((s, [, n]) => s + n, 0);
  const barrasUf = [
    ...ufs.slice(0, 5).map(([uf, n]) => ({ rotulo: uf, n })),
    ...(outras ? [{ rotulo: 'Outras', n: outras }] : []),
    ...(d.resumo.porUf.nao_informado ? [{ rotulo: 'Não informado', n: d.resumo.porUf.nao_informado, neutro: true }] : []),
  ];
  const m = d.resumo.porMedalha;
  const barrasMedalha = [
    { rotulo: 'Platinum', n: m.platinum }, { rotulo: 'Gold', n: m.gold }, { rotulo: 'MercadoLíder', n: m.silver },
    { rotulo: 'Sem medalha', n: m.sem }, { rotulo: 'Não informado', n: m.nao_informado, neutro: true },
  ].filter((b) => b.n > 0);

  return (
    <section className="cartao quanto-vende catalogo" aria-labelledby="ct-titulo">
      {cabeca(selo)}

      {p.estado === 'participa' && (
        <div className="ct-participacao">
          <div className="ct-linha">
            <span className="ct-rotulo">Sua oferta</span>
            <span className="mono ct-forte">{brl(p.preco)}</span>
          </div>
          <div className="ct-linha">
            <span className="ct-rotulo">Posição por preço</span>
            <span className="mono">{p.posicao === null ? 'Indisponível em leitura parcial' : `${p.posicao}º de ${num(d.leitura.carregadas)}${p.empatada ? ' (empatada)' : ''}`}</span>
          </div>
          {p.ptw && (
            <div className={`ct-ptw ${p.ptw.status}`}>
              <span>{PTW[p.ptw.status]}</span>
              {p.ptw.status === 'competing' && p.ptw.precoParaGanhar !== null && <span className="mono ct-forte">{brl(p.ptw.precoParaGanhar)}</span>}
            </div>
          )}
        </div>
      )}
      {/* Anúncio pausado sai da ficha: o dado prova ausência de oferta ATIVA, não de anúncio. */}
      {p.estado === 'nao_participa' && <p className="nota">Nenhuma oferta ativa da sua empresa neste catálogo.</p>}
      {p.estado === 'nao_localizada' && <p className="nota">Sua oferta não foi localizada nesta leitura parcial.</p>}

      <div className="ct-vencedor">
        <h3 className="qv-sub">Vencedor</h3>
        {d.vencedor ? (
          <>
            <div className="ct-linha">
              <span className="ct-vencedor-nome">
                {vencedor?.vendedor?.nickname ?? (d.vencedor.sellerId !== null ? `Vendedor ${d.vencedor.sellerId} · perfil não carregado` : 'Vendedor não identificado')}
              </span>
              <span className="mono ct-forte">{brl(d.vencedor.preco)}</span>
            </div>
            <span className="nota">{d.vencedor.origem === 'api' ? 'Informado pelo Mercado Livre' : 'Buy box desta página'}</span>
            {!naP && (
              <button type="button" className="link" onClick={() => onSimular(d.vencedor!.preco)}>
                {`Simular minha margem a ${brl(d.vencedor.preco)}`}
              </button>
            )}
          </>
        ) : <p className="nota">Vencedor não informado pelo Mercado Livre.</p>}
      </div>

      <div className="ct-resumo">
        <dl className="qv-numeros ct-resumo-numeros">
          <div><dt>Vendedores</dt><dd className="mono">{num(d.resumo.vendedores)}</dd></div>
          {/* Contados por oferta (um vendedor pode ter várias), diferente de "Vendedores". */}
          <div><dt>Ofertas Full</dt><dd className="mono">{num(d.resumo.full)}</dd></div>
          <div><dt>Ofertas oficiais</dt><dd className="mono">{num(d.resumo.lojasOficiais)}</dd></div>
        </dl>
        <div className="ct-linha">
          <span className="ct-rotulo">Faixa de preço</span>
          <span className="mono ct-forte">
            {d.resumo.menorPreco !== null ? `${brl(d.resumo.menorPreco)} a ${brl(d.resumo.maiorPreco!)}` : parcial ? 'Indisponível em leitura parcial' : 'Sem ofertas'}
          </span>
        </div>
      </div>

      <div className="ct-ofertas">
        <div className="ct-ofertas-cabeca">
          <h3 className="qv-sub">Ofertas</h3>
          <div className="segmentado ct-ordem">
            <div className="opcoes" role="radiogroup" aria-label="Ordenar ofertas por">
              {(['preco', 'reputacao', 'medalha'] as const).map((o) => (
                <label key={o}>
                  <input type="radio" name={nomeOrdem} checked={ordem === o} onChange={() => setOrdem(o)} />
                  {o === 'preco' ? 'Preço' : o === 'reputacao' ? 'Reputação' : 'Medalha'}
                </label>
              ))}
            </div>
          </div>
        </div>
        {d.ofertas.length === 0 && <p className="nota">Nenhuma oferta ativa neste catálogo.</p>}
        <ul className="ct-lista" aria-label="Ofertas do catálogo">
          {visiveis.map((o) => (
            <li key={o.itemId} className={o.propria ? 'propria' : undefined}>
              <div className="ct-oferta-topo">
                <span className={`ct-nome${o.vendedor ? '' : ' desconhecido'}`}>{o.vendedor?.nickname ?? `Vendedor ${o.sellerId} · perfil não carregado`}</span>
                <span className="mono ct-forte">{brl(o.preco)}</span>
              </div>
              <div className="ct-oferta-detalhe">
                {o.vendedor?.nivel && REPUTACAO[o.vendedor.nivel] && (
                  <span className="ct-rep"><span className={`ponto ${REPUTACAO[o.vendedor.nivel].cor}`} aria-hidden="true" />{REPUTACAO[o.vendedor.nivel].texto}</span>
                )}
                {o.vendedor?.medalha && MEDALHA[o.vendedor.medalha] && <span>{MEDALHA[o.vendedor.medalha].nome}</span>}
                {o.vendedor?.uf && <span>{o.vendedor.uf}</span>}
                {o.propria && <span className="ct-tag sua">Sua</span>}
                {o.vencedora && <span className="ct-tag vencedora">Vencedora</span>}
                {o.full && <span className="ct-tag">Full</span>}
                {o.lojaOficial && <span className="ct-tag">Oficial</span>}
                {o.tipo === 'gold_pro' && <span className="ct-tag">Premium</span>}
              </div>
            </li>
          ))}
        </ul>
        {d.ofertas.length > LINHAS && (
          <button type="button" className="link" onClick={() => setTodas(!todas)}>
            {todas ? 'Ver menos' : parcial ? `Ver ${num(d.ofertas.length)} ofertas carregadas` : `Ver todas (${num(d.ofertas.length)})`}
          </button>
        )}
      </div>

      <div className="ct-distribuicao">
        <Barras titulo="Vendedores por UF" itens={barrasUf} total={d.resumo.vendedores} />
        <Barras titulo="Vendedores por medalha" itens={barrasMedalha} total={d.resumo.vendedores} />
        <p className="nota">{`Perfis carregados: ${num(d.resumo.perfisCarregados)} de ${num(d.resumo.vendedores)} vendedores`}</p>
      </div>
    </section>
  );
}
