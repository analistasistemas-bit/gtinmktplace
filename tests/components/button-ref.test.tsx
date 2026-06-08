import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { Button } from '@/components/ui/button';

// Regressão: o Button (estilo radix-nova, escrito p/ React 19) precisa de forwardRef
// para funcionar no React 18 deste projeto. Sem isso, triggers asChild que dependem do
// ref (DropdownMenuTrigger -> Popper) não conseguem ancorar e o menu não abre.
describe('Button forwardRef (React 18)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('encaminha o ref para o elemento <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>ok</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('não emite o warning "Function components cannot be given refs"', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>ok</Button>);
    const refWarnings = spy.mock.calls.filter((c) =>
      String(c[0]).includes('Function components cannot be given refs'),
    );
    expect(refWarnings).toHaveLength(0);
  });
});
