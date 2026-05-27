import { describe, it, expect, vi } from 'vitest';
import { uploadFile, buildStoragePath, signedUrl } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ data: { path: 'u1/l1/00000123.jpeg' }, error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: 'https://signed.example/x' },
          error: null,
        }),
      })),
    },
  },
}));

describe('lib/storage', () => {
  it('buildStoragePath joins user/lote/filename', () => {
    expect(buildStoragePath('u1', 'l1', '00000123.jpeg')).toBe('u1/l1/00000123.jpeg');
  });

  it('buildStoragePath strips leading slashes from filename', () => {
    expect(buildStoragePath('u1', 'l1', '/sub/00000123.jpeg')).toBe('u1/l1/00000123.jpeg');
  });

  it('uploadFile returns the storage path on success', async () => {
    const file = new File(['x'], '00000123.jpeg', { type: 'image/jpeg' });
    const path = await uploadFile('imagens', 'u1/l1/00000123.jpeg', file);
    expect(path).toBe('u1/l1/00000123.jpeg');
    expect(supabase.storage.from).toHaveBeenCalledWith('imagens');
  });

  it('signedUrl returns the URL', async () => {
    const url = await signedUrl('imagens', 'u1/l1/00000123.jpeg', 60);
    expect(url).toBe('https://signed.example/x');
  });
});
