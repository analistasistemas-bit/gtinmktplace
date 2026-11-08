import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle } from '@/components/ui/alert-dialog';

// O padrão de "está processando": aura colorida no container, barra indeterminada e aria-busy.
// Ação destrutiva perde a aura de propósito — brilho que cicla três cores lê como comemoração,
// e o contrato de motion (§10) proíbe motion lúdico em exclusão.
describe('DialogContent — sinal de processamento', () => {
  const conteudo = () => document.querySelector('[data-slot="dialog-content"]')!;

  it('ocioso não tem aura, nem barra, e aria-busy é false', () => {
    render(
      <Dialog open>
        <DialogContent><DialogTitle>Teste</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('processando liga aura, barra e aria-busy', () => {
    render(
      <Dialog open>
        <DialogContent processando rotuloProcessando="Salvando produto">
          <DialogTitle>Teste</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conteudo()).toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Salvando produto');
    // Só aura + raio na tela: a barra fica apenas para leitor de tela.
    expect(screen.getByRole('progressbar')).toHaveClass('sr-only');
  });

  it('destrutivo suprime a aura mas mantém a barra', () => {
    render(
      <Dialog open>
        <DialogContent processando destrutivo rotuloProcessando="Excluindo produto">
          <DialogTitle>Teste</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).not.toHaveClass('sr-only');
  });

  it('a barra sem rótulo explícito ainda tem nome acessível', () => {
    render(
      <Dialog open>
        <DialogContent processando><DialogTitle>Teste</DialogTitle></DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Processando');
  });
});

describe('AlertDialogContent — sinal de processamento', () => {
  const conteudo = () => document.querySelector('[data-slot="alert-dialog-content"]')!;

  it('processando liga aura, barra e aria-busy', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent processando rotuloProcessando="Pausando anúncio">
          <AlertDialogTitle>Teste</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(conteudo()).toHaveClass('glow-effect-sombra');
    expect(conteudo()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Pausando anúncio');
    expect(screen.getByRole('progressbar')).toHaveClass('sr-only');
  });

  it('destrutivo suprime a aura mas mantém a barra', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent processando destrutivo rotuloProcessando="Removendo anúncio">
          <AlertDialogTitle>Teste</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(conteudo()).not.toHaveClass('glow-effect-sombra');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

// Raio de borda: acompanha a aura. Mesma regra — destrutivo não ganha motion lúdico.
type Props = { processando?: boolean; destrutivo?: boolean };
describe.each([
  {
    nome: 'DialogContent',
    slot: 'dialog-content',
    montar: (p: Props) => (
      <Dialog open>
        <DialogContent {...p}>
          <DialogTitle>Teste</DialogTitle>
          <input aria-label="campo" />
        </DialogContent>
      </Dialog>
    ),
  },
  {
    nome: 'AlertDialogContent',
    slot: 'alert-dialog-content',
    montar: (p: Props) => (
      <AlertDialog open>
        <AlertDialogContent {...p}>
          <AlertDialogTitle>Teste</AlertDialogTitle>
          <input aria-label="campo" />
        </AlertDialogContent>
      </AlertDialog>
    ),
  },
])('$nome — raio de borda', ({ slot, montar }) => {
  const conteudo = () => document.querySelector(`[data-slot="${slot}"]`)!;
  const raio = () => conteudo().querySelectorAll('.border-trail__track, .border-trail__fallback');

  it('processando mostra o raio dentro do conteúdo, sem wrapper .border-trail', () => {
    render(montar({ processando: true }));
    expect(raio()).toHaveLength(2);
    expect(conteudo().querySelector('.border-trail__track')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.border-trail')).toBeNull();
  });

  it('ocioso não mostra o raio', () => {
    render(montar({}));
    expect(raio()).toHaveLength(0);
  });

  it('destrutivo não mostra o raio', () => {
    render(montar({ processando: true, destrutivo: true }));
    expect(raio()).toHaveLength(0);
  });

  it('alternar processando não desmonta os filhos', () => {
    const { rerender } = render(montar({}));
    const campo = screen.getByLabelText('campo');
    rerender(montar({ processando: true }));
    expect(screen.getByLabelText('campo')).toBe(campo);
    expect(raio()).toHaveLength(2);
    rerender(montar({}));
    expect(screen.getByLabelText('campo')).toBe(campo);
    expect(raio()).toHaveLength(0);
  });
});
