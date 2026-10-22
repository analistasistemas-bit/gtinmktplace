// Painel lateral da Extensão PubliAI (ADR-0189 D-6/D-16). Mostra a última análise que o content
// script fez na aba ativa (guardada no SW) e simula preço/custo a partir dela.
import { useEffect, useState } from 'react';
import { MinhaMargem } from './MinhaMargem';
import { VinculoProduto } from './VinculoProduto';
import { mensagemDeErro, URL_APP, type Chamar, type EstadoAba, type Resposta, type RespostaAnuncio } from './formato';

const chamarViaSw: Chamar = async (corpo) => {
  try {
    return (await chrome.runtime.sendMessage({ tipo: 'publiai:chamar', corpo })) ?? { ok: false, erro: 'interno' };
  } catch {
    return { ok: false, erro: 'interno' };
  }
};

type Reanalisar = () => Promise<Resposta<RespostaAnuncio> | null>;

export function App() {
  // undefined = carregando; null = aba sem análise.
  const [estado, setEstado] = useState<EstadoAba | null | undefined>(undefined);
  const [tabId, setTabId] = useState<number | null>(null);

  useEffect(() => {
    let abaAtual: number | null = null;
    const carregar = async (tabId: number) => {
      const e = (await chrome.runtime.sendMessage({ tipo: 'publiai:estado-da-aba', tabId }).catch(() => null)) as EstadoAba | null;
      if (tabId !== abaAtual) return; // trocou de aba no meio
      setEstado(e ?? null);
    };
    // Sem a permissão `tabs`: o id da aba ativa vem mesmo assim.
    const lerAbaAtiva = async () => {
      const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
      abaAtual = aba?.id ?? null;
      setTabId(abaAtual);
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
  // O SW refaz a análise da aba e guarda o resultado: trocar de aba e voltar não traz o estado velho.
  const reanalisarAba: Reanalisar = () =>
    chrome.runtime.sendMessage({ tipo: 'publiai:reanalisar-aba', tabId }).catch(() => ({ ok: false, erro: 'interno' }));
  // Remonta (zera preço/custo digitados) só quando muda o anúncio; mesmo anúncio mantém a simulação.
  return <Painel key={estado?.entrada.mlItemId ?? 'vazio'} estado={estado} chamar={chamarViaSw} reanalisarAba={reanalisarAba} />;
}

export function Painel({ estado, chamar, reanalisarAba }: { estado: EstadoAba | null; chamar: Chamar; reanalisarAba: Reanalisar }) {
  // Preço confirmado no servidor vale só enquanto o estado da aba for o mesmo de quando foi pedido.
  const [confirmado, setConfirmado] = useState<{ base: EstadoAba['resposta']; dados: RespostaAnuncio } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!estado) return <p className="nota">Abra um anúncio do Mercado Livre para ver sua margem.</p>;
  const { entrada } = estado;
  const resposta: Resposta<RespostaAnuncio> =
    confirmado?.base === estado.resposta ? { ok: true, dados: confirmado.dados } : estado.resposta;

  const analisar = (preco: number) =>
    chamar<RespostaAnuncio>({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...entrada, preco });
  // O SW grava e avisa (estado-atualizado); o App recarrega o estado.
  const reanalisar = async () => {
    setOcupado(true);
    await reanalisarAba();
    setOcupado(false);
  };

  const anuncio = <p className="nota">{`Anúncio ${entrada.mlItemId}`}</p>;
  if (!resposta.ok) {
    return (
      <div className="bloco">
        {anuncio}
        <p className="aviso">{mensagemDeErro(resposta.erro)}</p>
        <button type="button" className="secundario" disabled={ocupado} onClick={reanalisar}>Tentar de novo</button>
      </div>
    );
  }
  if (resposta.dados.proprio) {
    return (
      <div className="bloco">
        {anuncio}
        <p>Este anúncio é da sua empresa.</p>
        <a className="botao" href={URL_APP} target="_blank" rel="noopener noreferrer">Abrir no PubliAI</a>
      </div>
    );
  }
  return (
    <>
      {anuncio}
      <MinhaMargem
        entrada={entrada}
        dados={resposta.dados}
        analisar={analisar}
        onDados={(dados) => setConfirmado({ base: estado.resposta, dados })}
      />
      {resposta.dados.custo.fonte === 'nenhuma' && (
        <VinculoProduto entrada={entrada} chamar={chamar} onVinculado={reanalisar} />
      )}
    </>
  );
}
