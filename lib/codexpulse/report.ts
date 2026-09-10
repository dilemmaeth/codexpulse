import type { CategoryStat, MonthView, ProjectStat } from './analytics';
import { categoryLabel } from './i18n';
import type { Language } from './types';

export type ReportPayload = {
  language: Language;
  monthLabel: string;
  generatedLabel: string;
  view: MonthView;
  includeProjects: boolean;
};

const compact = (value: number, language: Language) => new Intl.NumberFormat(language === 'hu' ? 'hu-HU' : 'en-US', {
  notation: 'compact', maximumFractionDigits: 1,
}).format(value);

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, weight = 500, align: CanvasTextAlign = 'left') {
  context.fillStyle = color;
  context.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textAlign = align;
  context.fillText(value, x, y);
}

function drawMetric(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, value: string, detail: string) {
  roundRect(context, x, y, width, 170, 24);
  context.fillStyle = '#0d1b26';
  context.fill();
  context.strokeStyle = 'rgba(130,180,196,.18)';
  context.stroke();
  text(context, label.toUpperCase(), x + 24, y + 38, 16, '#668394', 700);
  text(context, value, x + 24, y + 102, 42, '#f0f8fb', 700);
  text(context, detail, x + 24, y + 140, 16, '#607481', 500);
}

function drawBars(context: CanvasRenderingContext2D, items: CategoryStat[], language: Language, x: number, y: number, width: number) {
  const colors = ['#52e5db', '#9187ff', '#5f9ff5', '#edb96b', '#68dcb5', '#647784'];
  items.slice(0, 6).forEach((item, index) => {
    const rowY = y + index * 66;
    text(context, categoryLabel(language, item.id), x, rowY, 19, '#b8c8d1', 550);
    text(context, `${item.taskShare.toFixed(0)}%`, x + width, rowY, 18, '#dbe8ed', 650, 'right');
    roundRect(context, x, rowY + 18, width, 9, 5);
    context.fillStyle = 'rgba(129,162,179,.12)';
    context.fill();
    roundRect(context, x, rowY + 18, Math.max(8, width * item.taskShare / 100), 9, 5);
    context.fillStyle = colors[index];
    context.fill();
  });
}

function drawProjects(context: CanvasRenderingContext2D, items: ProjectStat[], x: number, y: number, width: number) {
  items.slice(0, 5).forEach((item, index) => {
    const rowY = y + index * 50;
    text(context, item.name, x, rowY, 18, '#aebfc8', 540);
    text(context, `${item.share.toFixed(0)}%`, x + width, rowY, 18, '#d9e7ec', 650, 'right');
  });
}

export function renderReport(payload: ReportPayload) {
  const { language, monthLabel, generatedLabel, view, includeProjects } = payload;
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CANVAS');

  const gradient = context.createLinearGradient(0, 0, 1240, 1754);
  gradient.addColorStop(0, '#07121b');
  gradient.addColorStop(1, '#04090e');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(980, 40, 0, 980, 40, 500);
  glow.addColorStop(0, 'rgba(52,213,215,.18)');
  glow.addColorStop(1, 'rgba(52,213,215,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, 600);

  text(context, 'CODEXPULSE', 70, 92, 22, '#52e5db', 750);
  text(context, monthLabel, 70, 174, 58, '#f0f8fb', 720);
  text(context, language === 'hu' ? 'Személyes Codex havi riport' : 'Personal Codex monthly report', 70, 220, 22, '#79909e', 500);
  if (view.month.estimated) {
    roundRect(context, 1010, 68, 160, 48, 24);
    context.fillStyle = 'rgba(237,185,107,.13)';
    context.fill();
    text(context, language === 'hu' ? 'BECSÜLT' : 'ESTIMATED', 1090, 99, 16, '#edbd75', 750, 'center');
  }

  const usageIndex = view.usageIndex === null ? '—' : `${Math.round(view.usageIndex)}%`;
  const resultsIndex = view.resultsIndex === null ? '—' : `${Math.round(view.resultsIndex)}%`;
  drawMetric(context, 70, 288, 340, language === 'hu' ? 'Használati index' : 'Usage index', usageIndex, language === 'hu' ? 'személyes átlaghoz' : 'vs personal average');
  drawMetric(context, 450, 288, 340, language === 'hu' ? 'Összes token' : 'Total tokens', compact(view.month.usage.totalTokens, language), language === 'hu' ? 'cache-sel együtt' : 'including cache');
  drawMetric(context, 830, 288, 340, language === 'hu' ? 'Eredményindex' : 'Results index', resultsIndex, `${view.outcomes.success + view.outcomes.partial * 0.5} ${language === 'hu' ? 'eredménypont' : 'outcome points'}`);

  roundRect(context, 70, 500, 1100, 560, 30);
  context.fillStyle = '#0a1721';
  context.fill();
  context.strokeStyle = 'rgba(130,180,196,.15)';
  context.stroke();
  text(context, language === 'hu' ? 'FÓKUSZMEGOSZLÁS' : 'FOCUS BREAKDOWN', 105, 558, 17, '#5f8495', 750);
  text(context, language === 'hu' ? 'Feladatok szerint' : 'By task count', 105, 598, 28, '#e9f2f6', 650);
  drawBars(context, view.categories, language, 105, 662, 1000);

  const lowerY = 1100;
  roundRect(context, 70, lowerY, 530, 470, 30);
  context.fillStyle = '#0a1721';
  context.fill();
  context.strokeStyle = 'rgba(130,180,196,.15)';
  context.stroke();
  text(context, language === 'hu' ? 'EREDMÉNYEK' : 'RESULTS', 105, lowerY + 58, 17, '#5f8495', 750);
  const resultRows = language === 'hu'
    ? [['Sikeres', view.outcomes.success], ['Részleges', view.outcomes.partial], ['Sikertelen', view.outcomes.failed], ['Folyamatban', view.outcomes.open]] as const
    : [['Successful', view.outcomes.success], ['Partial', view.outcomes.partial], ['Failed', view.outcomes.failed], ['In progress', view.outcomes.open]] as const;
  resultRows.forEach(([label, value], index) => {
    text(context, label, 105, lowerY + 126 + index * 72, 21, '#9db0bb', 520);
    text(context, String(value), 550, lowerY + 126 + index * 72, 23, '#e8f2f6', 700, 'right');
  });

  roundRect(context, 640, lowerY, 530, 470, 30);
  context.fillStyle = '#0a1721';
  context.fill();
  context.strokeStyle = 'rgba(130,180,196,.15)';
  context.stroke();
  text(context, includeProjects ? (language === 'hu' ? 'PROJEKTEK' : 'PROJECTS') : (language === 'hu' ? 'AKTIVITÁS' : 'ACTIVITY'), 675, lowerY + 58, 17, '#5f8495', 750);
  if (includeProjects) {
    drawProjects(context, view.projects, 675, lowerY + 126, 450);
  } else {
    const labels = language === 'hu' ? ['Aktív nap', 'Feladat', 'Forduló'] : ['Active days', 'Tasks', 'Turns'];
    const values = [view.month.days.filter((day) => day.totalTokens > 0).length, view.tasks.length, view.totalTurns];
    labels.forEach((label, index) => {
      text(context, label, 675, lowerY + 126 + index * 82, 21, '#9db0bb', 520);
      text(context, String(values[index]), 1125, lowerY + 126 + index * 82, 25, '#e8f2f6', 700, 'right');
    });
  }

  text(context, language === 'hu' ? 'Eredménypont: sikeres 1 · részleges 0,5 · sikertelen/nyitott 0. A besorolás javítható becslés.' : 'Outcome points: success 1 · partial 0.5 · failed/open 0. Classification is a correctable estimate.', 70, 1628, 16, '#79909e', 500);
  text(context, generatedLabel, 70, 1668, 16, '#536b78', 500);
  text(context, language === 'hu' ? 'API-egyenértékű költség · nem ChatGPT-számla' : 'API-equivalent cost · not a ChatGPT bill', 1170, 1668, 16, '#536b78', 500, 'right');
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('CANVAS_BLOB')), type, quality));
}

function concat(chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function pdfFromCanvas(canvas: HTMLCanvasElement) {
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const push = (chunk: Uint8Array) => { chunks.push(chunk); length += chunk.length; };
  const ascii = (value: string) => encoder.encode(value);
  push(ascii('%PDF-1.4\n%âãÏÓ\n'));
  const object = (id: number, body: Uint8Array) => {
    offsets[id] = length;
    push(ascii(`${id} 0 obj\n`)); push(body); push(ascii('\nendobj\n'));
  };
  object(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, ascii('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  object(4, concat([ascii(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, ascii('\nendstream')]));
  const drawing = ascii('q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ');
  object(5, concat([ascii(`<< /Length ${drawing.length} >>\nstream\n`), drawing, ascii('\nendstream')]));
  const xref = length;
  push(ascii('xref\n0 6\n0000000000 65535 f \n'));
  for (let id = 1; id <= 5; id += 1) push(ascii(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`));
  push(ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob([concat(chunks)], { type: 'application/pdf' });
}

async function deliver(blob: Blob, filename: string, title: string) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportReport(payload: ReportPayload, format: 'png' | 'pdf') {
  const canvas = renderReport(payload);
  const base = `CodexPulse-${payload.view.month.id}`;
  if (format === 'png') {
    await deliver(await canvasBlob(canvas, 'image/png'), `${base}.png`, 'CodexPulse');
  } else {
    await deliver(await pdfFromCanvas(canvas), `${base}.pdf`, 'CodexPulse');
  }
}
