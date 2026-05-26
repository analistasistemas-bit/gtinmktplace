import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';

describe('Supabase client', () => {
  it('é uma instância válida do supabase-js', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.auth).toBe('object');
  });

  it('está configurado com VITE_SUPABASE_URL do env', () => {
    expect(import.meta.env.VITE_SUPABASE_URL).toMatch(/^https:\/\//);
    expect(import.meta.env.VITE_SUPABASE_ANON_KEY).toBeTruthy();
  });
});
