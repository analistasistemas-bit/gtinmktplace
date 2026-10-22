// Service worker da Extensão PubliAI (ADR-0189 D-4/D-14). Único contexto que toca
// chrome.storage.session; content scripts e painel falam com ele por mensagem.
import { chamarExtensao } from './api';
import { eanDaAba, esquecerAba, registrarEanDaAba } from './abas';
import { receberMensagemExterna } from './sessao';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Sessão empurrada pelo PubliAI web; a origem é conferida dentro de receberMensagemExterna.
chrome.runtime.onMessageExternal.addListener((msg, sender, responder) => {
  receberMensagemExterna(msg, sender).then(responder, () => responder({ ok: false }));
  return true;
});

type Mensagem =
  | { tipo: 'publiai:ean-da-busca'; ean: string }
  | { tipo: 'publiai:ean-da-aba'; tabId: number }
  | { tipo: 'publiai:chamar'; corpo: object }
  | { tipo: 'publiai:abrir-painel' };

chrome.runtime.onMessage.addListener((msg: Mensagem, sender, responder) => {
  if (sender.id !== chrome.runtime.id) return false;
  const tabId = sender.tab?.id;
  switch (msg?.tipo) {
    case 'publiai:ean-da-busca':
      if (tabId === undefined || typeof msg.ean !== 'string' || !/^\d{8,14}$/.test(msg.ean)) return false;
      registrarEanDaAba(tabId, msg.ean).then(() => responder({ ok: true }));
      return true;
    case 'publiai:ean-da-aba':
      eanDaAba(msg.tabId).then(responder);
      return true;
    case 'publiai:chamar':
      chamarExtensao(msg.corpo).then(responder);
      return true;
    case 'publiai:abrir-painel':
      // Síncrono de propósito: sidePanel.open exige o gesto do usuário (spike da Task 7, Step 5).
      if (tabId !== undefined) chrome.sidePanel.open({ tabId }).catch(() => {});
      return false;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { esquecerAba(tabId); });
