import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Quanto rolar uma lista horizontal para o item ficar visível (0 se já está). Sem `scrollIntoView`: ele também rola a página. */
export function deslocamentoHorizontal(lista: { left: number; right: number }, item: { left: number; right: number }): number {
  if (item.right > lista.right) return item.right - lista.right;
  return item.left < lista.left ? item.left - lista.left : 0;
}
