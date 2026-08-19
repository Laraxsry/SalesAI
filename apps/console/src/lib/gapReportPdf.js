import { jsPDF } from 'jspdf';
import { ROBOTO_REGULAR_BASE64 } from './fonts/robotoRegularBase64.js';
import { ROBOTO_BOLD_BASE64 } from './fonts/robotoBoldBase64.js';

const GROUP_LABELS = {
    inconsistency: 'Tutarsızlıklar',
    thin: 'Yetersiz Detay',
    missing: 'Eksik Konular'
};

/**
 * Renders a GAP report to a PDF and triggers a browser download — entirely
 * client-side, from data the Console already has in memory (the report was
 * already fetched via `GET /knowledge/:productId/gap-analysis`). No LLM/API
 * call happens here — this is purely a client-side rendering of the exact
 * findings already shown in `KnowledgeGaps.jsx`, so downloading a report
 * costs nothing beyond generating the file.
 *
 * @param {object} report - a KnowledgeGapReport as returned by the API
 * @param {{ productName?: string, statusLabel: string, sourceTitleById: Map<string,string> }} opts
 */
export function downloadGapReportPdf(report, { productName, statusLabel, sourceTitleById }) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // jsPDF's built-in fonts (helvetica/times/courier) only cover
    // WinAnsiEncoding — Turkish characters outside that range (ı, İ, ğ, Ğ,
    // ş, Ş) get mapped to the wrong glyph (showing up as stray digits/
    // symbols) and jsPDF falls back to incorrect advance widths for them,
    // which is what produced the uneven letter spacing. Embedding a real
    // TTF with full Latin Extended-A coverage fixes both — jsPDF then reads
    // the font's own cmap/glyph-width tables instead of guessing.
    // (Font source: pdfmake's bundled Roboto, Apache-2.0 licensed; Turkish
    // glyph coverage verified with fontkit before embedding — see the
    // generated files' header comments.)
    doc.addFileToVFS('Roboto-Regular.ttf', ROBOTO_REGULAR_BASE64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', ROBOTO_BOLD_BASE64);
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');

    const marginX = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - marginX * 2;
    const lineHeight = 14;
    let y = 50;

    function ensureSpace(height) {
        if (y + height > pageHeight - 40) {
            doc.addPage();
            y = 50;
        }
    }

    function addHeading(text, size) {
        ensureSpace(size + 10);
        doc.setFont('Roboto', 'bold');
        doc.setFontSize(size);
        doc.setTextColor(20, 20, 20);
        doc.text(text, marginX, y);
        y += size + 8;
    }

    function addText(text, { bold = false, size = 10, color = [50, 50, 50] } = {}) {
        doc.setFont('Roboto', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lines = doc.splitTextToSize(text, maxWidth);
        for (const line of lines) {
            ensureSpace(lineHeight);
            doc.text(line, marginX, y);
            y += lineHeight;
        }
    }

    addHeading('Knowledge GAP Raporu', 18);
    if (productName) addText(`Ürün: ${productName}`, { bold: true, size: 11 });
    addText(`Tarih: ${new Date(report.createdAt).toLocaleString('tr-TR')}`);
    addText(`Durum: ${statusLabel}`);
    if (report.sourceCount) addText(`Analiz edilen kaynak sayısı: ${report.sourceCount}`);
    if (report.truncated) {
        addText('Not: kaynak sayısı çok fazla olduğu için bazı kaynaklar analiz dışı kaldı.', {
            color: [180, 120, 20]
        });
    }
    y += 8;

    if (report.status === 'failed') {
        addText(`Analiz başarısız oldu: ${report.error || 'bilinmeyen hata'}`, { color: [180, 40, 40] });
    } else if (!report.findings?.length) {
        addText('Hiçbir tutarsızlık/eksik bulunamadı — knowledge tabanı sağlam görünüyor.');
    } else {
        for (const type of ['inconsistency', 'thin', 'missing']) {
            const findings = report.findings.filter((f) => f.type === type);
            if (!findings.length) continue;

            y += 6;
            addHeading(`${GROUP_LABELS[type]} (${findings.length})`, 13);

            findings.forEach((f, i) => {
                addText(`${i + 1}. ${f.title}`, { bold: true, size: 11 });
                addText(f.description, { size: 10 });
                if (f.sourceIds?.length) {
                    const titles = f.sourceIds.map((id) => sourceTitleById?.get(id) || id).join(', ');
                    addText(`Kaynaklar: ${titles}`, { size: 9, color: [120, 120, 120] });
                }
                y += 6;
            });
        }
    }

    const dateSlug = new Date(report.createdAt).toISOString().slice(0, 10);
    doc.save(`gap-raporu-${dateSlug}.pdf`);
}
