# PubliAI — Brand Assets

Identidade visual oficial do PubliAI (Conceito 3 — "Publicação / Destinos").
Símbolo 100% vetorial; wordmark "PubliAI" em **Geist** convertido em curvas (sem dependência de fonte instalada).

## Estrutura

```
PubliAI-Brand/
├── SVG/                      vetorial (curvas, editável)
│   ├── horizontal/          símbolo + wordmark lado a lado
│   ├── empilhado/           símbolo acima do wordmark
│   └── simbolo/             só o símbolo
├── PNG/                      raster transparente, @1x / @2x / @3x
│   ├── horizontal/
│   ├── empilhado/
│   └── simbolo/
├── Icons/                    favicon, app icon, apple-touch, maskable
└── README.md
```

Cada pasta tem 4 variantes:

| Variante | Uso |
|---|---|
| `full-dark` | full color sobre fundo escuro (wordmark claro) |
| `full-light` | full color sobre fundo claro (wordmark escuro) |
| `mono-white` | monocromática branca (knockout) |
| `mono-black` | monocromática preta |

## Cores

| Uso | HEX | OKLCH |
|---|---|---|
| Indigo primário | `#5A5CE2` | `oklch(0.55 0.20 277)` |
| Violeta de apoio | `#9152E3` | `oklch(0.585 0.21 300)` |
| Gradiente de marca (135°) | `#5C5CEB → #9152E3` | — |
| Fundo escuro | `#08090E` | `oklch(0.14 0.012 277)` |
| Fundo claro | `#FBFCFF` | `oklch(0.99 0.004 277)` |
| Texto claro | `#F1F1F5` | — |
| Texto escuro | `#161822` | — |

Tipografia: **Geist** (Geist Variable), títulos peso 600, tracking levemente negativo.

## Ícones

| Arquivo | Uso |
|---|---|
| `favicon.svg` | favicon vetorial (navegador) |
| `favicon-16/32/48.png` | favicon raster |
| `apple-touch-icon.png` | 180px, ícone iOS (fundo escuro) |
| `maskable-192/512.png` | PWA maskable (safe-area 80%) |

## Usos proibidos

- Não alterar as cores do gradiente.
- Não distorcer proporções nem rotacionar o símbolo.
- Não adicionar sombra, contorno ou efeitos.
- Não trocar a tipografia do wordmark.

## Como regenerar

Os assets são gerados por script a partir do símbolo vetorial + Geist:
`docs/brand/PubliAI-Brand/` é produzido via fonttools (instancia Geist em peso 600,
converte o texto em curvas) + `rsvg-convert` (exporta PNGs/ícones). O símbolo vive
também como componente React em `src/components/ui/logo.tsx` (fonte da verdade no app).
