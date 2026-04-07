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

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.floor((sorted.length - 1) * p);
  return sorted[index];
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width));
  const height = 220;
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
  return ctx;
}

export function renderHistogram(canvas: HTMLCanvasElement, series: HistogramSeries[], title: string): void {
  const ctx = setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(280, Math.floor(rect.width));
  const height = 220;
  const left = 44;
  const right = width - 12;
  const top = 20;
  const bottom = height - 30;

  const allValues = series.flatMap((item) => item.values);
  const minValue = percentile(allValues, 0.02);
  const maxValue = percentile(allValues, 0.98);
  const span = Math.max(0.0001, maxValue - minValue);

  ctx.fillStyle = "#f3f6fb";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111";
  ctx.font = "600 13px 'Space Grotesk', sans-serif";
  ctx.fillText(title, left, 14);

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
  const barWidth = (right - left) / bins;

  ctx.strokeStyle = "#6a7484";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  for (let s = 0; s < histograms.length; s += 1) {
    const alpha = 0.52;
    ctx.fillStyle = `${series[s].color}${Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0")}`;
    for (let i = 0; i < bins; i += 1) {
      const count = histograms[s][i];
      const barHeight = (count / maxCount) * (bottom - top);
      const x = left + i * barWidth + s * ((barWidth - 2) / histograms.length);
      const y = bottom - barHeight;
      const w = Math.max(1, (barWidth - 3) / histograms.length);
      ctx.fillRect(x, y, w, barHeight);
    }
  }

  ctx.fillStyle = "#222";
  ctx.font = "12px 'IBM Plex Sans', sans-serif";
  ctx.fillText(`${minValue.toFixed(4)} ms`, left, height - 10);
  ctx.fillText(`${maxValue.toFixed(4)} ms`, right - 70, height - 10);
}

export function renderLineChart(canvas: HTMLCanvasElement, series: LineSeries[], title: string): void {
  const ctx = setupCanvas(canvas);
  const width = Math.max(280, Math.floor(canvas.getBoundingClientRect().width));
  const height = 220;
  const left = 44;
  const right = width - 18;
  const top = 20;
  const bottom = height - 36;

  const xs = series.flatMap((line) => line.points.map((point) => point.x));
  const ys = series.flatMap((line) => line.points.map((point) => point.y));

  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0.001);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(0.0001, maxY - minY);

  ctx.fillStyle = "#f3f6fb";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111";
  ctx.font = "600 13px 'Space Grotesk', sans-serif";
  ctx.fillText(title, left, 14);

  ctx.strokeStyle = "#6a7484";
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

  ctx.fillStyle = "#1e2330";
  ctx.font = "12px 'IBM Plex Sans', sans-serif";
  ctx.fillText(`${minY.toFixed(4)} ms`, left, height - 12);
  ctx.fillText(`${maxY.toFixed(4)} ms`, right - 64, height - 12);
}
