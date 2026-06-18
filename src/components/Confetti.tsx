import { useEffect } from "react";

interface ConfettiOptions {
  particleCount?: number;
  spread?: number;
  startVelocity?: number;
  decay?: number;
  gravity?: number;
}

/**
 * Fires a confetti burst whenever `trigger` changes to a new positive value.
 * Use a counter (incremented per click) rather than a boolean so repeated
 * clicks on the same feature re-fire the burst instead of staying latched.
 */
export function useConfetti(trigger: number, options: ConfettiOptions = {}) {
  const {
    particleCount = 80,
    spread = 60,
    startVelocity = 25,
    decay = 0.94,
    gravity = 1,
  } = options;

  useEffect(() => {
    if (trigger <= 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = "fixed";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "9999";
    document.body.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      document.body.removeChild(canvas);
      return;
    }

    const ctxNonNull = ctx as CanvasRenderingContext2D;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      color: string;
    }

    const colors = [
      "#1e7a5f",
      "#30b98f",
      "#48d597",
      "#7ae8c1",
      "#4078d9",
      "#6ba3ff",
      "#f5b800",
      "#ffcc4d",
    ];

    const particles: Particle[] = [];
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2.5;

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const velocityMultiplier = 0.5 + Math.random();
      particles.push({
        x: centerX,
        y: centerY,
        vx:
          Math.cos(angle) *
          startVelocity *
          velocityMultiplier *
          (Math.random() > 0.5 ? 1 : -1),
        vy:
          Math.sin(angle) *
          startVelocity *
          velocityMultiplier *
          (Math.random() > 0.5 ? 0.8 : 1.2),
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    let animationFrameId: number;

    function animate() {
      ctxNonNull.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= decay;
        p.vy *= decay;
        p.life -= 0.008;

        if (p.life > 0) {
          ctxNonNull.fillStyle = p.color;
          ctxNonNull.globalAlpha = p.life;
          const size = 4 + Math.random() * 4;
          ctxNonNull.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        } else {
          particles.splice(i, 1);
        }
      }

      ctxNonNull.globalAlpha = 1;

      if (particles.length > 0) {
        animationFrameId = requestAnimationFrame(animate);
      } else {
        document.body.removeChild(canvas);
      }
    }

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (canvas.parentNode) {
        document.body.removeChild(canvas);
      }
    };
  }, [trigger, particleCount, spread, startVelocity, decay, gravity]);
}
