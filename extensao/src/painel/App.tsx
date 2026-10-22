// Painel lateral da Extensão PubliAI (ADR-0189 D-6/D-16). Mostra a última análise que o content
// script fez na aba ativa (guardada no SW) e simula preço/custo a partir dela.
import { useEffect, useState } from 'react';
import { MinhaMargem } from './MinhaMargem';
import { VinculoProduto } from './VinculoProduto';
import { mensagemDeErro, URL_APP, type Chamar, type EstadoAba, type RespostaAnuncio } from './formato';

const chamarViaSw: Chamar = async (corpo) => {
  try {
    return (await chrome.runtime.sendMessage({ tipo: 'publiai:chamar', corpo })) ?? { ok: false, erro: 'interno' };
  } catch {
    return { ok: false, erro: 'interno' };
  }
};

export function App() {
  // undefined = carregando; null = aba sem análise.
  const [estado, setEstado] = useState<EstadoAba | null | undefined>(undefined);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let abaAtual: number | null = null;
    const carregar = async (tabId: number) => {
      const e = (await chrome.runtime.sendMessage({ tipo: 'publiai:estado-da-aba', tabId }).catch(() => null)) as EstadoAba | null;
      if (tabId !== abaAtual) return; // trocou de aba no meio
      setEstado(e ?? null);
      setVersao((v) => v + 1);
    };
    // Sem a permissão `tabs`: o id da aba ativa vem mesmo assim.
    const lerAbaAtiva = async () => {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      abaAtual = aba?.id ?? null;
      if (abaAtual === null) setEstado(null);
      else await carregar(abaAtual);
    };
    const aoMensagem = (m: unknown) => {
      const msg = m as { tipo?: unknown; tabId?: unknown } | null;
      if (msg?.tipo === 'publiai:estado-atualizado' && msg.tabId === abaAtual && abaAtual !== null) void carregar(abaAtual);
    };
    const aoAtivar = () => { void lerAbaAtiva(); };
    chrome.runtime.onMessage.addListener(aoMensagem);
    chrome.tabs.onActivated.addListener(aoAtivar);
    void lerAbaAtiva();
    return () => {
      chrome.runtime.onMessage.removeListener(aoMensagem);
      chrome.tabs.onActivated.removeListener(aoAtivar);
    };
  }, []);

  if (estado === undefined) return <p className="nota">Carregando…</p>;
  return <Painel key={versao} estado={estado} chamar={chamarViaSw} />;
}

export function Painel({ estado, chamar }: { estado: EstadoAba | null; chamar: Chamar }) {
  const [resposta, setResposta] = useState(estado?.resposta);
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  if (!estado || !resposta) return <p className="nota">Abra um anúncio do Mercado Livre para ver sua margem.</p>;
  const { entrada } = estado;

  const analisar = (preco: number) =>
    chamar<RespostaAnuncio>({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada, preco });
  const reanalisar = async () => {
    setOcupado(true);
    setResposta(await analisar(entrada.preco));
    setVersao((v) => v + 1); // volta o simulador ao preço da página
    setOcupado(false);
  };

  if (!resposta.ok) {
    return (
      <div className="bloco">
        <p className="aviso">{mensagemDeErro(resposta.erro)}</p>
        <button type="button" className="secundario" disabled={ocupado} onClick={reanalisar}>Tentar de novo</button>
      </div>
    );
  }
  if (resposta.dados.proprio) {
    return (
      <div className="bloco">
        <p>Este anúncio é da sua empresa.</p>
        <a className="botao" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir no PubliAI</a>
      </div>
    );
  }
  return (
    <>
      <MinhaMargem
        key={versao}
        entrada={entrada}
        dados={resposta.dados}
        analisar={analisar}
        onDados={(dados) => setResposta({ ok: true, dados })}
      />
      {resposta.dados.custo.fonte === 'nenhuma' && (
        <VinculoProduto entrada={entrada} chamar={chamar} onVinculado={reanalisar} />
      )}
    </>
  );
}
