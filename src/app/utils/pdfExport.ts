/**
 * PDF EXPORT UTILITY
 *
 * Generates real downloadable .pdf files from HTML elements using
 * html2canvas + jsPDF.  Supports multi-page output with automatic
 * page breaks, headers/footers, and MARQ Cortex branding.
 *
 * Usage:
 *   import { exportToPDF } from '@/app/utils/pdfExport';
 *   await exportToPDF(elementRef.current, { filename: 'report.pdf' });
 */

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PDFExportOptions {
  /** Output filename (default: 'marq-cortex-report.pdf') */
  filename?: string;
  /** Page orientation (default: 'portrait') */
  orientation?: 'portrait' | 'landscape';
  /** Page format (default: 'a4') */
  format?: 'a4' | 'letter';
  /** Render scale for html2canvas (default: 2 for retina quality) */
  scale?: number;
  /** Top/bottom margin in mm (default: 15) */
  marginY?: number;
  /** Left/right margin in mm (default: 15) */
  marginX?: number;
  /** Show MARQ Cortex branding footer on each page (default: true) */
  showFooter?: boolean;
  /** Optional callback for progress updates (0-1) */
  onProgress?: (progress: number) => void;
}

export interface PDFExportResult {
  success: boolean;
  filename: string;
  pages: number;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PURPLE = '#8B5CF6';
const FOOTER_TEXT_COLOR = '#70707C';
const FOOTER_FONT_SIZE = 7;

// A4 in mm: 210 x 297
const PAGE_SIZES = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Chromium serialises a computed colour declared in oklch() back as an
 * `oklch(...)` string (CSS Color 4 keeps it in the oklch colour space), and a
 * 2D canvas `fillStyle` getter likewise round-trips oklch back as oklch — so
 * neither getComputedStyle nor fillStyle serialisation gets rid of it, and
 * html2canvas still throws "unsupported color function 'oklch'".
 *
 * To force a concrete sRGB value we actually *rasterise* the colour: paint a
 * single pixel with it on a 1×1 canvas (default sRGB colour space) and read the
 * pixel back with getImageData(). That yields plain rgb()/rgba() every time.
 */
function makeOklchConverter(doc: Document): (value: string) => string {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    ctx = null;
  }

  const convertToken = (token: string): string => {
    if (!ctx) return 'rgb(0, 0, 0)';
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000'; // fallback if `token` is rejected
      ctx.fillStyle = token;
      ctx.fillRect(0, 0, 1, 1); // rasterise to sRGB
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return a === 255
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
    } catch {
      return 'rgb(0, 0, 0)';
    }
  };

  return (value: string): string => {
    if (!value || value.indexOf('oklch') === -1) return value;
    // Replace every oklch(...) token individually so values that embed a
    // colour inside a larger declaration (box-shadow, gradients) still work.
    return value.replace(/oklch\([^)]*\)/gi, convertToken);
  };
}

function resolveOklchColors(doc: Document): void {
  // The cloned document lives inside an html2canvas iframe, so we MUST use
  // its own defaultView for getComputedStyle – not the parent `window`.
  const view = doc.defaultView ?? window;
  const toRgb = makeOklchConverter(doc);
  const root = doc.documentElement;

  // 1. Convert every oklch() CSS custom property on :root to rgb and inject an
  //    override <style> so that all var() references (in either light or .dark
  //    scope) resolve to rgb when html2canvas walks the clone.
  if (root) {
    const rootComputed = view.getComputedStyle(root);
    const overrides: string[] = [];
    for (let i = 0; i < rootComputed.length; i++) {
      const name = rootComputed.item(i);
      if (!name.startsWith('--')) continue; // custom properties only
      const raw = rootComputed.getPropertyValue(name).trim();
      if (!raw.includes('oklch')) continue;
      const rgb = toRgb(raw);
      root.style.setProperty(name, rgb);
      overrides.push(`${name}:${rgb}`);
    }
    if (overrides.length && doc.head) {
      const overrideStyle = doc.createElement('style');
      overrideStyle.setAttribute('data-oklch-override', '');
      overrideStyle.textContent = `:root,.dark{${overrides.join(';')}}`;
      doc.head.appendChild(overrideStyle);
    }
  }

  // 2. Neutralise any literal oklch(...) still present in the clone's <style>
  //    blocks (dev builds inline theme.css this way).  html2canvas parses raw
  //    stylesheet text and throws on oklch(); the per-element inlining below
  //    preserves the real colours, so rewriting the declarations is safe.
  doc.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent;
    if (css && css.includes('oklch')) {
      styleEl.textContent = toRgb(css);
    }
  });

  // 3. Convert oklch() away on every element. We can't rely on a fixed list of
  //    colour properties: html2canvas injects pseudo-element helper nodes whose
  //    *inline* styles carry oklch custom properties, and computed styles expose
  //    oklch through many colour channels (-webkit-text-fill-color,
  //    text-emphasis-color, gradients, box-shadow, …). So we scan dynamically —
  //    (a) rewrite any inline declaration that still holds oklch, then (b) inline
  //    the converted value of every *computed* property that resolves to oklch —
  //    guaranteeing html2canvas only ever parses rgb()/rgba().
  doc.querySelectorAll('*').forEach((el) => {
    const style = (el as HTMLElement).style;
    if (!style) return;

    // (a) Inline declarations (covers html2canvas pseudo-element helper nodes
    //     that copy custom properties like --foreground: oklch(...) inline).
    for (let i = style.length - 1; i >= 0; i--) {
      const prop = style.item(i);
      const value = style.getPropertyValue(prop);
      if (value && value.includes('oklch')) {
        style.setProperty(prop, toRgb(value), style.getPropertyPriority(prop));
      }
    }

    // (b) Computed properties that still resolve to oklch → inline rgb.
    const computed = view.getComputedStyle(el);
    for (let i = 0; i < computed.length; i++) {
      const prop = computed.item(i);
      const value = computed.getPropertyValue(prop);
      if (value && value.includes('oklch')) {
        style.setProperty(prop, toRgb(value));
      }
    }
  });
}

// ── Export function ──────────────────────────────────────────────────────────

export async function exportToPDF(
  element: HTMLElement,
  options: PDFExportOptions = {},
): Promise<PDFExportResult> {
  const {
    filename = 'marq-cortex-report.pdf',
    orientation = 'portrait',
    format = 'a4',
    scale = 2,
    marginY = 15,
    marginX = 15,
    showFooter = true,
    onProgress,
  } = options;

  try {
    onProgress?.(0.1);

    // 1. Capture element to canvas
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      // Remove scrolling artifacts
      windowWidth: element.scrollWidth,
      windowHeight: element.scrollHeight,
      onclone: (_doc: Document, clonedEl: HTMLElement) => {
        // Resolve oklch() → rgb() on every element in the clone so
        // html2canvas never encounters unsupported color functions.
        resolveOklchColors(clonedEl.ownerDocument);
      },
    });

    onProgress?.(0.5);

    // 2. Set up jsPDF
    const pageSize = PAGE_SIZES[format];
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format,
    });

    const pageWidth =
      orientation === 'portrait' ? pageSize.width : pageSize.height;
    const pageHeight =
      orientation === 'portrait' ? pageSize.height : pageSize.width;

    const contentWidth = pageWidth - marginX * 2;
    const contentHeight = pageHeight - marginY * 2 - (showFooter ? 8 : 0);

    // 3. Calculate image dimensions
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // 4. Slice into pages
    const totalPages = Math.ceil(imgHeight / contentHeight);
    const canvasSliceHeight = (canvas.height * contentHeight) / imgHeight;

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();

      // Calculate the slice of the canvas for this page
      const srcY = page * canvasSliceHeight;
      const srcHeight = Math.min(canvasSliceHeight, canvas.height - srcY);

      // Create a temporary canvas for this page slice
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = srcHeight;

      const ctx = pageCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(
        canvas,
        0, srcY, canvas.width, srcHeight,       // source rect
        0, 0, pageCanvas.width, pageCanvas.height, // dest rect
      );

      const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
      const sliceImgHeight = (srcHeight * imgWidth) / canvas.width;

      pdf.addImage(
        pageImgData,
        'JPEG',
        marginX,
        marginY,
        imgWidth,
        sliceImgHeight,
      );

      // Footer
      if (showFooter) {
        pdf.setFontSize(FOOTER_FONT_SIZE);
        pdf.setTextColor(FOOTER_TEXT_COLOR);

        const footerY = pageHeight - 8;

        // Left: branding
        pdf.text('MARQ Cortex  |  AI Operations Diagnostic', marginX, footerY);

        // Right: page number
        const pageLabel = `Page ${page + 1} of ${totalPages}`;
        const textWidth = pdf.getTextWidth(pageLabel);
        pdf.text(pageLabel, pageWidth - marginX - textWidth, footerY);

        // Accent bar
        pdf.setDrawColor(PURPLE);
        pdf.setLineWidth(0.5);
        pdf.line(marginX, footerY - 3, pageWidth - marginX, footerY - 3);
      }

      onProgress?.(0.5 + (0.45 * (page + 1)) / totalPages);
    }

    // 5. Save
    pdf.save(filename);

    onProgress?.(1);

    return { success: true, filename, pages: totalPages };
  } catch (err: any) {
    console.error('PDF export failed:', err);
    return {
      success: false,
      filename,
      pages: 0,
      error: err?.message || 'PDF export failed',
    };
  }
}

// ── Convenience: export from a self-contained HTML string ────────────────────

export async function exportHTMLToPDF(
  html: string,
  options: PDFExportOptions = {},
): Promise<PDFExportResult> {
  // Create a temporary off-screen container
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-9999px;top:0;width:800px;background:#fff;';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    // Wait for images to load
    const images = container.querySelectorAll('img');
    await Promise.all(
      Array.from(images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) return resolve();
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
      ),
    );

    return await exportToPDF(container, options);
  } finally {
    document.body.removeChild(container);
  }
}