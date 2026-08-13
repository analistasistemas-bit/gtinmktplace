// Ponte PubliAI -> extensão. Sem CORS e sem credencial: o app fala por postMessage na própria
// página; a extensão nunca chama a API do PubliAI.
document.documentElement.dataset.publiaiExtensao = chrome.runtime.getManifest().version;

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const msg = ev.data;
  if (msg?.tipo !== 'publiai:resolver-catalogo' || !Array.isArray(msg.lote) || msg.lote.length === 0) return;
  chrome.runtime.sendMessage({ tipo: 'abrir-painel', lote: msg.lote });
});
