import { useEffect, useRef, useState } from 'react';
import type { Campo } from '@/components/auth-particulas/campo';

/** Abaixo disso o campo entra com metade da densidade e sem interação de ponteiro. */
const LARGURA_MOBILE = 768;

/**
 * Só vale carregar o Three depois de saber que o campo roda aqui. A simulação escreve numa
 * textura float, o que exige WebGL2 com `EXT_color_buffer_float`; sem isso o import seria
 * 170KB gastos para nada. Também é o que mantém o Three fora dos testes, onde o jsdom não
 * devolve contexto nenhum.
 */
function suportaCampo(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2');
    if (!ctx) return false;
    const ok = !!ctx.getExtension('EXT_color_buffer_float');
    ctx.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Tokens da marca convertidos de oklch para hex — o `THREE.Color` não entende `oklch()`, e
 * resolver a variável em runtime exigiria pintar num canvas só para ler o pixel de volta.
 * Os dois primeiros vêm de `src/index.css`: --primary e o fim do --brand-gradient.
 *
 * O terceiro é o contraste puro contra o fundo do tema — branco no dark, quase-preto no
 * light. Sem ele o campo inteiro fica na mesma faixa de violeta e some no fundo preto do
 * shell de auth; é o que dá o brilho que faz o efeito aparecer.
 */
const CORES: Record<'dark' | 'light', [string, string, string]> = {
  dark: ['#737cf7', '#a670f3', '#ffffff'],
  light: ['#5c5ceb', '#9152e3', '#241b30'],
};

export interface AuthParticulasProps {
  /** 0–300. Quantidade de partículas via distância mínima do Poisson-disk. */
  density?: number;
  particlesScale?: number;
  ringRadius?: number;
  ringWidth?: number;
  ringWidth2?: number;
  /** O que mais muda a personalidade do efeito: o quanto o anel empurra as partículas. */
  ringDisplacement?: number;
  theme?: 'dark' | 'light';
  /** Opacidade global. Baixa de propósito — aqui o formulário é a estrela, não o fundo. */
  opacity?: number;
}

/**
 * Fundo das telas de auth: campo de partículas com simulação GPGPU em Three.js, no mesmo
 * desenho da landing do Google Antigravity. O estado de cada partícula vive numa textura
 * float atualizada por um shader a cada quadro (ping-pong entre dois render targets), e o
 * "seguir o mouse" é um anel que persegue o cursor com interpolação lenta — o atraso é o
 * que dá a sensação orgânica. Detalhes da simulação em `auth-particulas/shaders.ts`.
 *
 * O Three entra por import dinâmico: são ~170KB gzip que não podem pesar no primeiro
 * carregamento de uma tela de login. Enquanto não chega — e em qualquer ambiente sem
 * WebGL2 com `EXT_color_buffer_float` — fica só o gradiente estático de fundo.
 */
export function AuthParticulas({
  density = 20,
  particlesScale = 0.59,
  ringRadius = 0.2,
  ringWidth = 0.006,
  ringWidth2 = 0.107,
  ringDisplacement = 0.35,
  theme = 'dark',
  opacity = 0.7,
}: AuthParticulasProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!suportaCampo()) return;

    let campo: Campo | null = null;
    let descartado = false;

    const mobile = window.innerWidth < LARGURA_MOBILE;
    const opcoes = {
      densidade: mobile ? density * 0.5 : density,
      escalaParticulas: particlesScale,
      raioAnel: ringRadius,
      larguraAnel: ringWidth,
      larguraAnel2: ringWidth2,
      deslocamentoAnel: ringDisplacement,
      opacidade: opacity,
      cores: CORES[theme],
      // jsdom não implementa matchMedia: sem a guarda, montar o AuthShell num teste explode.
      estatico:
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      semPonteiro: mobile,
    };

    import('@/components/auth-particulas/campo')
      .then(({ criarCampo }) => {
        if (descartado || !containerRef.current) return;
        campo = criarCampo(containerRef.current, opcoes);
        setAtivo(campo !== null);
      })
      .catch(() => {
        // Sem o chunk do Three (offline, bloqueio de rede) fica o gradiente estático.
      });

    return () => {
      descartado = true;
      campo?.destruir();
      setAtivo(false);
    };
  }, [
    density,
    particlesScale,
    ringRadius,
    ringWidth,
    ringWidth2,
    ringDisplacement,
    theme,
    opacity,
  ]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="auth-particulas pointer-events-none absolute inset-0"
    >
      {!ativo && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_40%,oklch(0.64_0.18_277/0.10),transparent)]" />
      )}
    </div>
  );
}
