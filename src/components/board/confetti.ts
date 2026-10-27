/**
 * A small confetti burst on a full-screen canvas (no library): paper pieces in the Tide colors
 * fall from the top and from two cannons at the sides. Stops on its own.
 */
const COLORS = ["#2f5bea", "#7b4dff", "#f5c451", "#34d399", "#ff6b57", "#ffffff"];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  tilt: number;
}

export function burst(canvas: HTMLCanvasElement, opts: { count?: number; duration?: number } = {}): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
  };
  resize();
  const W = () => canvas.width / ratio;
  const H = () => canvas.height / ratio;
  const count = opts.count ?? 260;
  const duration = opts.duration ?? 5200;
  const pieces: Piece[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    const side = i % 3; // 0 rain from the top, 1 left cannon, 2 right cannon
    const base: Piece = {
      x: side === 0 ? rand(0, W()) : side === 1 ? -10 : W() + 10,
      y: side === 0 ? rand(-H() * 0.4, -10) : H() * rand(0.55, 0.9),
      vx: side === 0 ? rand(-40, 40) : side === 1 ? rand(260, 620) : rand(-620, -260),
      vy: side === 0 ? rand(60, 180) : rand(-720, -380),
      w: rand(7, 13),
      h: rand(10, 20),
      rot: rand(0, Math.PI * 2),
      vr: rand(-6, 6),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      tilt: rand(0, Math.PI * 2),
    };
    pieces.push(base);
  }
  let last = performance.now();
  const start = last;
  let frame = 0;
  let stopped = false;
  const gravity = 520;
  const drag = 0.985;
  const tick = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const age = now - start;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W(), H());
    const fade = age > duration - 900 ? Math.max(0, (duration - age) / 900) : 1;
    let alive = 0;
    for (const p of pieces) {
      p.vy += gravity * dt;
      p.vx *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += dt * 4;
      if (p.y > H() + 30) continue;
      alive++;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.abs(Math.cos(p.tilt)) * 0.8 + 0.2);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < duration && alive > 0) frame = requestAnimationFrame(tick);
    else {
      ctx.clearRect(0, 0, W(), H());
      stopped = true;
    }
  };
  window.addEventListener("resize", resize);
  frame = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W(), H());
  };
}
