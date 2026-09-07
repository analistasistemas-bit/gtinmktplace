import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COOLDOWN_KEY,
  isStandalone,
  isIOS,
  isDismissed,
  setDismissCooldown,
  clearDismissCooldown,
} from '../pwa-install';

describe('pwa-install utils', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('isStandalone', () => {
    it('retorna true quando display-mode standalone está ativo no matchMedia', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(isStandalone()).toBe(true);
    });

    it('retorna true quando navigator.standalone legado é true', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      });

      expect(isStandalone()).toBe(true);

      // cleanup
      delete (navigator as unknown as { standalone?: boolean }).standalone;
    });

    it('retorna false quando nem matchMedia nem navigator.standalone indicam standalone', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(isStandalone()).toBe(false);
    });
  });

  describe('isIOS', () => {
    it('retorna true para iPhone no userAgent quando não está em standalone', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
        configurable: true,
      });

      expect(isIOS()).toBe(true);
    });

    it('retorna true para iPadOS moderno (MacIntel + maxTouchPoints > 1)', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 5,
        configurable: true,
      });

      expect(isIOS()).toBe(true);
    });

    it('retorna false para macOS desktop (MacIntel mas maxTouchPoints == 0)', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      });

      expect(isIOS()).toBe(false);
    });

    it('retorna false para Android', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 13; SM-S908B)',
        configurable: true,
      });
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux armv8l',
        configurable: true,
      });

      expect(isIOS()).toBe(false);
    });

    it('retorna false se já estiver em modo standalone mesmo sendo iPhone', () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)',
        configurable: true,
      });

      expect(isIOS()).toBe(false);
    });
  });

  describe('Cooldown (isDismissed, setDismissCooldown, clearDismissCooldown)', () => {
    it('retorna false se não houver cooldown gravado', () => {
      expect(isDismissed()).toBe(false);
    });

    it('grava cooldown com padrão de 7 dias e retorna true se ainda não expirou', () => {
      const now = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      setDismissCooldown(7);

      const expectedExpiration = now + 7 * 24 * 60 * 60 * 1000;
      expect(localStorage.getItem(COOLDOWN_KEY)).toBe(String(expectedExpiration));
      expect(isDismissed()).toBe(true);
    });

    it('retorna false se o cooldown já expirou', () => {
      const pastTime = Date.now() - 1000;
      localStorage.setItem(COOLDOWN_KEY, String(pastTime));

      expect(isDismissed()).toBe(false);
    });

    it('clearDismissCooldown remove o item do localStorage', () => {
      localStorage.setItem(COOLDOWN_KEY, String(Date.now() + 10000));
      expect(isDismissed()).toBe(true);

      clearDismissCooldown();
      expect(isDismissed()).toBe(false);
      expect(localStorage.getItem(COOLDOWN_KEY)).toBeNull();
    });
  });
});
