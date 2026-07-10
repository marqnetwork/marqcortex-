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
 * html2canvas cannot parse oklch() colour functions that Tailwind v4 / our
 * theme.css uses.  This helper walks every element in a *cloned* document
 * and inlines the browser-computed (rgb) values for all colour-related CSS
 * properties so html2canvas only ever sees rgb()/rgba().
 */
const COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'textDecorationColor',
  'boxShadow',
  'caretColor',
  'columnRuleColor',
  'fill',
  'stroke',
] as const;

function resolveOklchColors(doc: Document): void {
  // The cloned document lives inside an html2canvas iframe, so we MUST use
  // its own defaultView for getComputedStyle – not the parent `window`.
  const view = doc.defaultView ?? window;

  // 1. Resolve oklch() in CSS custom properties on :root / <html> so that
  //    html2canvas never encounters them when it resolves var() references.
  const root = doc.documentElement;
  if (root) {
    const rootComputed = view.getComputedStyle(root);
    const rootLen = rootComputed.length;
    for (let i = 0; i < rootLen; i++) {
      const name = rootComputed.item(i);
      // Only touch custom properties (--*)
      if (!name.startsWith('--')) continue;
      const raw = rootComputed.getPropertyValue(name).trim();
      if (raw.includes('oklch')) {
        // Read the resolved (rgb) value the browser already computed
        root.style.setProperty(name, raw);
        // Force a temp element to resolve oklch → rgb via the browser
        const tmp = doc.createElement('span');
        tmp.style.color = `var(${name})`;
        root.appendChild(tmp);
        const resolved = view.getComputedStyle(tmp).color;
        root.removeChild(tmp);
        if (resolved) {
          root.style.setProperty(name, resolved);
        }
      }
    }
  }

  // 2. Inline computed (rgb) values for every colour-related CSS property
  //    on every element so html2canvas never sees oklch().
  const els = doc.querySelectorAll('*');
  els.forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const computed = view.getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const value = computed[prop as any];
      if (value && typeof value === 'string' && value !== '') {
        (el.style as any)[prop] = value; // browser already resolved to rgb
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