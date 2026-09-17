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
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
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
