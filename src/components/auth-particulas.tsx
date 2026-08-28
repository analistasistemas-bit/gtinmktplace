import { useEffect, useRef } from 'react';

/** 1 partícula a cada ~2400px² (≈ 540 em 1440×900), com teto para telas grandes. */
const DENSIDADE = 1 / 2400;
const MAX_PARTICULAS = 900;
/** Raio de influência do cursor, em px. Fora dele a partícula fica no estado de repouso. */
const RAIO_CURSOR = 230;
/** Fração do caminho até o alvo percorrida por frame (easing exponencial). */
const SUAVIZACAO = 0.1;
/** Quanto o traço estica e acende no centro do halo (multiplicadores sobre o repouso). */
const GANHO_COMPRIMENTO = 0.9;
const GANHO_BRILHO = 2.2;

// ponytail: cores em RGB fixo — o shell de auth é sempre dark (ADR-0080), e ler
// `--brand-gradient` exigiria um probe de getComputedStyle + parse de oklch só para
// chegar nos mesmos três tons. Hues da marca (277–300).
const CORES: Array<[rgb: string, alpha: number]> = [
  ['139, 108, 255', 0.4],
  ['176, 102, 245', 0.36],
  ['120, 160, 255', 0.26],
];

/**
 * Estado da partícula em função do cursor: para onde apontar e o quanto está sob
 * influência (0 = repouso, 1 = colada no cursor). O `peso` alimenta ângulo, brilho e
 * comprimento — só a rotação move os extremos do traço em ~2px, invisível sozinha.
 *
 * A rotação é módulo π: o traço é simétrico, então girar 180° dá o mesmo desenho e
 * seria só uma pirueta à toa quando o cursor cruza a partícula.
 */
export function orientar(
  base: number,
  px: number,
  py: number,
  mx: number,
  my: number,
  raio = RAIO_CURSOR,
): { ang: number; peso: number } {
  const dx = mx - px;
  const dy = my - py;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist >= raio) return { ang: base, peso: 0 };

  let delta = (Math.atan2(dy, dx) - base) % Math.PI;
  if (delta > Math.PI / 2) delta -= Math.PI;
  if (delta < -Math.PI / 2) delta += Math.PI;

  const peso = 1 - dist / raio;
  return { ang: base + delta * peso, peso };
}

interface Particula {
  x: number;
  y: number;
  base: number;
  ang: number;
  peso: number;
  comprimento: number;
  rgb: string;
  alpha: number;
}

/**
 * Campo de partículas do fundo das telas de auth: traços curtos que giram apontando
 * para o cursor e acendem em volta dele. Puramente decorativo (`aria-hidden` +
 * `pointer-events-none`) — por isso os listeners ficam no `window`, não no canvas.
 */
export function AuthParticulas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursor = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom não implementa canvas 2D — testes montam o shell sem efeito

    let particulas: Particula[] = [];
    let raf = 0;

    function montar() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const largura = canvas!.clientWidth;
      const altura = canvas!.clientHeight;
      canvas!.width = Math.round(largura * dpr);
      canvas!.height = Math.round(altura * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const total = Math.min(MAX_PARTICULAS, Math.round(largura * altura * DENSIDADE));
      particulas = Array.from({ length: total }, () => {
        const base = Math.random() * Math.PI;
        const [rgb, alpha] = CORES[Math.floor(Math.random() * CORES.length)];
        return {
          x: Math.random() * largura,
          y: Math.random() * altura,
          base,
          ang: base,
          peso: 0,
          comprimento: 9 + Math.random() * 8,
          rgb,
          alpha,
        };
      });
    }

    function desenhar() {
      ctx!.clearRect(0, 0, canvas!.clientWidth, canvas!.clientHeight);
      ctx!.lineCap = 'round';
      ctx!.lineWidth = 2;
      for (const p of particulas) {
        const alvo = orientar(p.base, p.x, p.y, cursor.current.x, cursor.current.y);
        p.ang += (alvo.ang - p.ang) * SUAVIZACAO;
        p.peso += (alvo.peso - p.peso) * SUAVIZACAO;

        const meio = (p.comprimento * (1 + p.peso * GANHO_COMPRIMENTO)) / 2;
        const dx = Math.cos(p.ang) * meio;
        const dy = Math.sin(p.ang) * meio;
        ctx!.strokeStyle = `rgba(${p.rgb}, ${p.alpha * (1 + p.peso * GANHO_BRILHO)})`;
        ctx!.beginPath();
        ctx!.moveTo(p.x - dx, p.y - dy);
        ctx!.lineTo(p.x + dx, p.y + dy);
        ctx!.stroke();
      }
    }

    montar();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      desenhar(); // campo estático nos ângulos base: sem RAF, sem listener de mouse
      const aoRedimensionarEstatico = () => {
        montar();
        desenhar();
      };
      window.addEventListener('resize', aoRedimensionarEstatico);
      return () => window.removeEventListener('resize', aoRedimensionarEstatico);
    }

    const aoMover = (e: MouseEvent) => {
      const r = canvas!.getBoundingClientRect();
      cursor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // No `document`, `mouseleave` só dispara ao sair da janela. No `window`, `mouseout`
    // dispararia a cada troca de elemento sob o cursor e apagaria o halo em pleno movimento.
    const aoSair = () => {
      cursor.current = { x: -9999, y: -9999 };
    };

    window.addEventListener('mousemove', aoMover, { passive: true });
    document.addEventListener('mouseleave', aoSair);
    window.addEventListener('resize', montar);

    const loop = () => {
      desenhar();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', aoMover);
      document.removeEventListener('mouseleave', aoSair);
      window.removeEventListener('resize', montar);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
