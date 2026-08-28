import { useEffect, useRef } from 'react';

/** 1 partícula a cada ~3200px² (≈ 400 em 1440×900), com teto para telas grandes. */
const DENSIDADE = 1 / 3200;
const MAX_PARTICULAS = 700;
/** Raio de influência do cursor, em px. Fora dele a partícula mantém o ângulo base. */
const RAIO_CURSOR = 260;
/** Fração do caminho até o ângulo alvo percorrida por frame (easing exponencial). */
const SUAVIZACAO = 0.1;

// ponytail: cores em rgba fixo — o shell de auth é sempre dark (ADR-0080), e ler
// `--brand-gradient` exigiria um probe de getComputedStyle + parse de oklch só para
// chegar nos mesmos três tons. Hues da marca (277–300).
const CORES = [
  'rgba(139, 108, 255, 0.45)',
  'rgba(176, 102, 245, 0.40)',
  'rgba(120, 160, 255, 0.28)',
];

/**
 * Ângulo que a partícula deve assumir dado o cursor. O traço é simétrico, então a
 * rotação mínima é módulo π — sem isso a partícula gira 180° à toa ao cruzar o cursor.
 * Peso linear pela distância: cola no cursor de perto, ignora de longe.
 */
export function anguloAlvo(
  base: number,
  px: number,
  py: number,
  mx: number,
  my: number,
  raio = RAIO_CURSOR,
): number {
  const dx = mx - px;
  const dy = my - py;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist >= raio) return base;

  let delta = (Math.atan2(dy, dx) - base) % Math.PI;
  if (delta > Math.PI / 2) delta -= Math.PI;
  if (delta < -Math.PI / 2) delta += Math.PI;

  return base + delta * (1 - dist / raio);
}

interface Particula {
  x: number;
  y: number;
  base: number;
  ang: number;
  comprimento: number;
  cor: string;
}

/**
 * Campo de partículas do fundo das telas de auth: traços curtos que se orientam
 * em direção ao cursor, com falloff por distância. Puramente decorativo
 * (`aria-hidden` + `pointer-events-none`) — os listeners ficam no `window`.
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
        return {
          x: Math.random() * largura,
          y: Math.random() * altura,
          base,
          ang: base,
          comprimento: 5 + Math.random() * 5,
          cor: CORES[Math.floor(Math.random() * CORES.length)],
        };
      });
    }

    function desenhar() {
      ctx!.clearRect(0, 0, canvas!.clientWidth, canvas!.clientHeight);
      ctx!.lineCap = 'round';
      ctx!.lineWidth = 2;
      for (const p of particulas) {
        const alvo = anguloAlvo(p.base, p.x, p.y, cursor.current.x, cursor.current.y);
        p.ang += (alvo - p.ang) * SUAVIZACAO;
        const dx = (Math.cos(p.ang) * p.comprimento) / 2;
        const dy = (Math.sin(p.ang) * p.comprimento) / 2;
        ctx!.strokeStyle = p.cor;
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
    const aoSair = () => {
      cursor.current = { x: -9999, y: -9999 };
    };

    window.addEventListener('mousemove', aoMover, { passive: true });
    window.addEventListener('mouseout', aoSair);
    window.addEventListener('resize', montar);

    const loop = () => {
      desenhar();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', aoMover);
      window.removeEventListener('mouseout', aoSair);
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
