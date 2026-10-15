import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { getSession, verifyOtp, ordem } = vi.hoisted(() => {
  const ordem: string[] = [];
  return {
    ordem,
    // O getSession só resolve depois que o client terminou de recuperar/renovar a sessão
    // guardada (initializePromise) — é o que remove uma sessão velha antes do verifyOtp.
    getSession: vi.fn(async () => { ordem.push('getSession'); return { data: { session: null } }; }),
    verifyOtp: vi.fn(async () => { ordem.push('verifyOtp'); return { error: null }; }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession, verifyOtp, updateUser: vi.fn() } } }));

import DefinirSenha from '../DefinirSenha';

describe('DefinirSenha', () => {
  it('espera a sessão guardada assentar antes de validar o link do convite', async () => {
    render(
      <MemoryRouter initialEntries={['/definir-senha?token_hash=abc&type=invite']}>
        <DefinirSenha />
      </MemoryRouter>,
    );
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' }));
    expect(ordem).toEqual(['getSession', 'verifyOtp']);
  });
});
