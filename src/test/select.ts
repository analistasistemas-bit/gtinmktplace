import { fireEvent, screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

// Radix Select por teclado (jsdom não tem hasPointerCapture; padrão de barra-filtros-estoque.test).
export async function abrirSelect(user: User, rotulo: string | RegExp) {
  screen.getByRole('combobox', { name: rotulo }).focus();
  await user.keyboard('{Enter}');
}

// `texto` = rótulo visível da opção; `rotulos` traduz valor -> rótulo quando o teste fala em valores.
export async function escolherNoSelect(user: User, rotulo: string | RegExp, texto: string, rotulos: Record<string, string> = {}) {
  await abrirSelect(user, rotulo);
  await screen.findAllByRole('option');
  // Radix abre com o foco no item selecionado (ou no primeiro): navega por setas até o alvo.
  const itens = screen.getAllByRole('option');
  const quer = rotulos[texto] ?? texto;
  // Fallback: opções "código — descrição" (origem NF-e, CSOSN) casam pelo código.
  let alvo = itens.findIndex((o) => o.textContent === quer);
  if (alvo < 0) alvo = itens.findIndex((o) => o.textContent?.startsWith(`${quer} — `));
  if (alvo < 0) throw new Error(`Opção "${texto}" não encontrada`);
  const atual = Math.max(0, itens.findIndex((o) => o === document.activeElement));
  const passos = alvo - atual;
  if (passos) await user.keyboard(`{${passos > 0 ? 'ArrowDown' : 'ArrowUp'}>${Math.abs(passos)}/}`);
  // Um único keydown: Enter faria o keypress/click cair no botão do AlertDialog que abre em seguida; Espaço seleciona no keydown e o keyup vai para o item.
  const item = document.activeElement!;
  await user.keyboard('{ >}');
  fireEvent.keyUp(item, { key: ' ' });
}
