chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tipo !== 'abrir-painel') return;
  chrome.storage.session.set({ lote: msg.lote }).then(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('painel.html') });
  });
});
