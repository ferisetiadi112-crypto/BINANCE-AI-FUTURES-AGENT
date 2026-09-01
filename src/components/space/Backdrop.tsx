function starLayer(seed: number, count: number, size: number, opacity: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const shadows: string[] = [];
  for (let i = 0; i < count; i++) {
    shadows.push(`${(rnd() * 100).toFixed(2)}vw ${(rnd() * 100).toFixed(2)}vh`);
  }
  return { shadows, size, opacity };
}

const layers = [starLayer(11, 90, 1, 0.5), starLayer(29, 40, 2, 0.32)];

/** Deep-space backdrop: stars, nebula wash, technical grid and horizon lines. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />

      {/* nebula wash */}
      <div
        className="absolute -left-40 -top-40 h-[52rem] w-[52rem] rounded-full blur-[140px]"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.19 158 / 12%), transparent 65%)" }}
      />
      <div
        className="absolute -bottom-64 right-[-10rem] h-[46rem] w-[46rem] rounded-full blur-[150px]"
        style={{ background: "radial-gradient(circle, oklch(0.6 0.14 200 / 9%), transparent 65%)" }}
      />

      {/* stars */}
      {layers.map((l, i) => (
        <div key={i} className="absolute inset-0">
          {l.shadows.map((pos, j) => {
            const [x, y] = pos.split(" ");
            return (
              <span
                key={j}
                className="absolute rounded-full bg-foreground"
                style={{
                  left: x,
                  top: y,
                  width: l.size,
                  height: l.size,
                  opacity: l.opacity,
                }}
              />
            );
          })}
        </div>
      ))}

      {/* technical grid */}
      <div
        className="grid-field absolute inset-0 opacity-40"
        style={{ maskImage: "radial-gradient(ellipse at 50% 0%, black 10%, transparent 75%)" }}
      />

      {/* horizon lines */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="absolute bottom-24 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,transparent_40%,oklch(0.1_0.02_180/70%)_100%)]" />
    </div>
  );
}
