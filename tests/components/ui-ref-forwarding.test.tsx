import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

// Guard de regressão. Os primitivos shadcn (estilo radix-nova) assumem React 19, onde
// `ref` é uma prop comum. Este projeto é React 18, então cada primitivo interativo
// PRECISA de React.forwardRef — caso contrário um trigger `asChild` que depende do ref
// (ex.: DropdownMenuTrigger -> Popper) não consegue ancorar e o conteúdo não abre. O pior:
// o jsdom não reproduz o posicionamento do Popper, então só estoura no navegador. Este
// teste falha se algum primitivo perder o forwardRef (ao regenerar via CLI do shadcn, etc.).
describe('forwardRef dos primitivos interativos (React 18)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Button encaminha o ref para <button>', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('Input encaminha o ref para <input>', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('Textarea encaminha o ref para <textarea>', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('Badge encaminha o ref para <span>', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>x</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });

  it('nenhum primitivo emite o warning "Function components cannot be given refs"', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <>
        <Button ref={createRef<HTMLButtonElement>()}>a</Button>
        <Input ref={createRef<HTMLInputElement>()} />
        <Textarea ref={createRef<HTMLTextAreaElement>()} />
        <Badge ref={createRef<HTMLSpanElement>()}>b</Badge>
      </>,
    );
    const warns = spy.mock.calls.filter((c) =>
      String(c[0]).includes('Function components cannot be given refs'),
    );
    expect(warns).toHaveLength(0);
  });
});
