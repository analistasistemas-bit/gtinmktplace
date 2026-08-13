import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useExtensaoCatalogo } from '@/hooks/useExtensaoCatalogo';

afterEach(() => {
  delete document.documentElement.dataset.publiaiExtensao;
  vi.useRealTimers();
});

describe('useExtensaoCatalogo', () => {
  it('false quando a extensão não está instalada', () => {
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(false);
  });

  it('true quando o marcador já existe no mount', () => {
    document.documentElement.dataset.publiaiExtensao = '0.1.0';
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(true);
  });

  it('true quando o marcador aparece depois (content script em document_idle)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useExtensaoCatalogo());
    expect(result.current).toBe(false);
    document.documentElement.dataset.publiaiExtensao = '0.1.0';
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(true);
  });
});
