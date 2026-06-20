export type HistogramSeries = {
  label: string;
  values: number[];
  color: string;
};

export type LinePoint = {
  x: number;
  y: number;
};

export type LineSeries = {
  label: string;
  points: LinePoint[];
  color: string;
};

/* ------------------------------------------------------------------ *
 * Robust statistics helpers
 * ------------------------------------------------------------------ */

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Mean after discarding the top and bottom `fraction` of samples — resists timer outliers. */
export function trimmedMean(values: number[], fraction = 0.1): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * fraction);
  const kept = sorted.slice(cut, sorted.length - cut);
  return mean(kept.length > 0 ? kept : sorted);
}

export function stdDev(values: number[], precomputedMean?: number): number {
  if (values.length === 0) {
    return 0;
  }
  const m = precomputedMean ?? mean(values);
  const variance = values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / values.length;
  return Math.sqrt(variance);
}

/** Cohen's d — standardized separation between two sample distributions. */
export function cohenD(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  const sa = stdDev(a, ma);
  const sb = stdDev(b, mb);
  const pooled = Math.sqrt((sa * sa + sb * sb) / 2);
  if (pooled === 0) {
    return 0;
  }
  return Math.abs(ma - mb) / pooled;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.floor((sorted.length - 1) * p);
  return sorted[index];
}

/* ------------------------------------------------------------------ *
 * Theme-aware canvas plumbing
 * ------------------------------------------------------------------ */

type ChartPalette = {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  axis: string;
};

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartPalette(): ChartPalette {
  return {
    surface: cssVar("--chart-surface", "#fffaf1"),
    text: cssVar("--text", "#111"),
    muted: cssVar("--muted", "#555"),
    grid: cssVar("--chart-grid", "rgba(0,0,0,0.08)"),
    axis: cssVar("--chart-axis", "#6a7484")
  };
}

const CHART_HEIGHT = 250;
const TITLE_FONT = "600 13px 'Space Grotesk', 'Segoe UI', sans-serif";
const LABEL_FONT = "12px 'IBM Plex Sans', 'Segoe UI', sans-serif";

type CanvasFrame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  palette: ChartPalette;
};

function setupCanvas(canvas: HTMLCanvasElement): CanvasFrame {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width) || 280);
  const height = CHART_HEIGHT;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context unavailable");
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height, palette: chartPalette() };
}

/** Lay out a wrapping legend; returns the y just below the last legend row. */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  series: { label: string; color: string }[],
  left: number,
  right: number,
  startY: number,
  palette: ChartPalette
): number {
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  const swatch = 11;
  const gap = 6;
  const itemGap = 16;
  const rowHeight = 18;
  let x = left;
  let y = startY;

  for (const item of series) {
    const labelWidth = ctx.measureText(item.label).width;
    const itemWidth = swatch + gap + labelWidth;
    if (x + itemWidth > right && x > left) {
      x = left;
      y += rowHeight;
    }
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - swatch / 2, swatch, swatch);
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y - swatch / 2 + 0.5, swatch, swatch);
    ctx.fillStyle = palette.muted;
    ctx.fillText(item.label, x + swatch + gap, y);
    x += itemWidth + itemGap;
  }
  ctx.textBaseline = "alphabetic";
  return y + rowHeight;
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) {
    return [min];
  }
  const rawStep = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function formatMs(value: number): string {
  if (value === 0) {
    return "0";
  }
  const abs = Math.abs(value);
  if (abs < 0.001) {
    return value.toExponential(1);
  }
  if (abs < 1) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

/* ------------------------------------------------------------------ *
 * Histogram
 * ------------------------------------------------------------------ */

export function renderHistogram(canvas: HTMLCanvasElement, series: HistogramSeries[], title: string): void {
  const { ctx, width, height, palette } = setupCanvas(canvas);

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = palette.text;
  ctx.font = TITLE_FONT;
  ctx.fillText(title, 12, 16);

  const legendBottom = drawLegend(ctx, series, 12, width - 12, 32, palette);

  const left = 52;
  const right = width - 14;
  const top = legendBottom + 4;
  const bottom = height - 30;

  const allValues = series.flatMap((item) => item.values);
  const minValue = percentile(allValues, 0.02);
  const maxValue = percentile(allValues, 0.98);
  const span = Math.max(1e-6, maxValue - minValue);

  const bins = 24;
  const histograms = series.map((item) => {
    const counts = new Array<number>(bins).fill(0);
    for (const value of item.values) {
      const normalized = Math.max(0, Math.min(0.99999, (value - minValue) / span));
      counts[Math.floor(normalized * bins)] += 1;
    }
    return counts;
  });

  const maxCount = Math.max(...histograms.flat(), 1);

  // y gridlines (counts) — integer steps so labels never collide or show fractions
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  const countStep = Math.max(1, Math.ceil(maxCount / 4));
  for (let tick = 0; tick <= maxCount; tick += countStep) {
    const y = bottom - (tick / maxCount) * (bottom - top);
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "right";
    ctx.fillText(String(tick), left - 6, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // axes
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  const barWidth = (right - left) / bins;
  for (let s = 0; s < histograms.length; s += 1) {
    ctx.fillStyle = withAlpha(series[s].color, 0.55);
    for (let i = 0; i < bins; i += 1) {
      const count = histograms[s][i];
      if (count === 0) {
        continue;
      }
      const barHeight = (count / maxCount) * (bottom - top);
      const x = left + i * barWidth + s * ((barWidth - 2) / histograms.length);
      const y = bottom - barHeight;
      const w = Math.max(1, (barWidth - 3) / histograms.length);
      ctx.fillRect(x, y, w, barHeight);
    }
  }

  // x axis labels
  ctx.fillStyle = palette.muted;
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(`${formatMs(minValue)} ms`, left, height - 10);
  ctx.textAlign = "center";
  ctx.fillText("batch time per sample →", (left + right) / 2, height - 10);
  ctx.textAlign = "right";
  ctx.fillText(`${formatMs(maxValue)} ms`, right, height - 10);
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------------ *
 * Line chart
 * ------------------------------------------------------------------ */

export function renderLineChart(canvas: HTMLCanvasElement, series: LineSeries[], title: string): void {
  const { ctx, width, height, palette } = setupCanvas(canvas);

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = palette.text;
  ctx.font = TITLE_FONT;
  ctx.fillText(title, 12, 16);

  const legendBottom = drawLegend(ctx, series, 12, width - 12, 32, palette);

  const left = 52;
  const right = width - 18;
  const top = legendBottom + 4;
  const bottom = height - 32;

  const xs = series.flatMap((line) => line.points.map((point) => point.x));
  const ys = series.flatMap((line) => line.points.map((point) => point.y));

  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1e-3);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);

  // y gridlines + ticks
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  for (const tick of niceTicks(minY, maxY, 4)) {
    const y = bottom - ((tick - minY) / spanY) * (bottom - top);
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "right";
    ctx.fillText(formatMs(tick), left - 6, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // axes
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  for (const line of series) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    line.points.forEach((point, index) => {
      const x = left + ((point.x - minX) / spanX) * (right - left);
      const y = bottom - ((point.y - minY) / spanY) * (bottom - top);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    for (const point of line.points) {
      const x = left + ((point.x - minX) / spanX) * (right - left);
      const y = bottom - ((point.y - minY) / spanY) * (bottom - top);
      ctx.fillStyle = line.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // x ticks (matching-byte positions)
  ctx.fillStyle = palette.muted;
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  const uniqueXs = Array.from(new Set(xs)).sort((a, b) => a - b);
  for (const xValue of uniqueXs) {
    const x = left + ((xValue - minX) / spanX) * (right - left);
    ctx.fillText(String(xValue), x, bottom + 14);
  }
  ctx.fillText("matching prefix bytes →", (left + right) / 2, height - 4);
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------------ *
 * Accessible data table
 * ------------------------------------------------------------------ */

export function renderDataTable(
  container: HTMLElement,
  caption: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const head = headers.map((h) => `<th scope="col">${h}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell, index) =>
          index === 0
            ? `<th scope="row">${cell}</th>`
            : `<td>${typeof cell === "number" ? cell.toFixed(4) : cell}</td>`
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  container.innerHTML = `
    <table>
      <caption>${caption}</caption>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/* ------------------------------------------------------------------ *
 * Color helpers
 * ------------------------------------------------------------------ */

function withAlpha(color: string, alpha: number): string {
  // Accepts #rrggbb; falls back to the raw color for non-hex inputs.
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${a}`;
  }
  return color;
}
