import { jsPDF } from "jspdf";

export function generateAuditPDF(auditData, audit) {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;
  let y = 20;
  
  const bizName = auditData.name || auditData.business_name || 'Business';
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ========== PAGE 1: COVER ==========
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 115, 232);
  doc.text('Google Business Audit Report', margin, y);
  y += 12;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(32, 33, 36);
  const nameLines = doc.splitTextToSize(bizName, contentWidth);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 7 + 4;

  doc.setFontSize(10);
  doc.setTextColor(95, 99, 104);
  doc.text('Generated on ' + dateStr, margin, y);
  y += 12;

  doc.setDrawColor(218, 220, 224);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  // Overall Score
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(95, 99, 104);
  doc.text('OVERALL AUDIT SCORE', margin, y);
  y += 12;

  const score = audit.score?.overall || 0;
  const scoreColor = score >= 80 ? [13, 158, 108] : score >= 60 ? [26, 115, 232] : score >= 40 ? [244, 180, 0] : [217, 48, 37];
  doc.setFontSize(52);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.text(score + '', margin, y + 4);
  doc.setFontSize(16);
  doc.setTextColor(95, 99, 104);
  doc.text(' / 100', margin + doc.getTextWidth(score + '') + 2, y + 4);
  y += 22;

  // Component breakdown bars
  if (audit.score?.components) {
    const comps = [
      { label: 'Profile', val: audit.score.components.profile },
      { label: 'Rating', val: audit.score.components.rating },
      { label: 'Reviews', val: audit.score.components.reviews },
      { label: 'Photos', val: audit.score.components.photos },
      { label: 'Sentiment', val: audit.score.components.sentiment }
    ];

    comps.forEach(c => {
      y = checkPageBreak(doc, y, 10);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(95, 99, 104);
      doc.text(c.label, margin, y);

      const barX = margin + 30;
      const barW = contentWidth - 50;
      doc.setFillColor(232, 234, 237);
      doc.roundedRect(barX, y - 3, barW, 5, 2, 2, 'F');

      const fillW = (c.val / 100) * barW;
      const bColor = c.val >= 70 ? [13, 158, 108] : c.val >= 40 ? [244, 180, 0] : [217, 48, 37];
      doc.setFillColor(bColor[0], bColor[1], bColor[2]);
      if (fillW > 0) doc.roundedRect(barX, y - 3, fillW, 5, 2, 2, 'F');

      doc.setTextColor(32, 33, 36);
      doc.text(c.val + '', pageWidth - margin - 5, y, { align: 'right' });
      y += 9;
    });
  }
  y += 6;

  // Executive summary
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 115, 232);
  doc.text('Executive Summary', margin, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(32, 33, 36);
  const rating = parseFloat(auditData.rating) || 0;
  const reviewCount = parseInt(auditData.reviewCount || auditData.review_count) || 0;
  const execSummary = `${bizName} scores ${score}/100 in our comprehensive audit. ` +
    `Profile completeness is at ${audit.profile?.score || 0}%. ` +
    ((audit.sentiment?.total || 0) > 0 ? `Sentiment analysis of ${audit.sentiment.total} reviews shows ${audit.sentiment.positive}% positive, ${audit.sentiment.neutral}% neutral, and ${audit.sentiment.negative}% negative.` : 'No reviews were available for sentiment analysis.');
  
  const execLines = doc.splitTextToSize(execSummary, contentWidth);
  doc.text(execLines, margin, y);
  y += execLines.length * 5 + 4;

  // ========== PAGE 2: PROFILE + BUSINESS INFO ==========
  doc.addPage();
  y = 20;

  y = pdfSectionHeader(doc, 'Profile Completeness \u2014 ' + (audit.profile?.score || 0) + '%', margin, y);

  doc.setFillColor(232, 234, 237);
  doc.roundedRect(margin, y, contentWidth, 6, 3, 3, 'F');
  const profFillW = ((audit.profile?.score || 0) / 100) * contentWidth;
  const profColor = (audit.profile?.score || 0) >= 80 ? [13, 158, 108] : (audit.profile?.score || 0) >= 50 ? [244, 180, 0] : [217, 48, 37];
  doc.setFillColor(profColor[0], profColor[1], profColor[2]);
  if (profFillW > 0) doc.roundedRect(margin, y, profFillW, 6, 3, 3, 'F');
  y += 14;

  if (audit.profile?.checklist) {
    audit.profile.checklist.forEach(item => {
      y = checkPageBreak(doc, y, 8);
      doc.setFontSize(9);
      const icon = item.present ? '\u2713' : '\u2717';
      const col = item.present ? [13, 158, 108] : [217, 48, 37];
      doc.setTextColor(col[0], col[1], col[2]);
      doc.setFont('helvetica', 'bold');
      doc.text(icon, margin, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(32, 33, 36);
      doc.text(item.label + (item.present ? '' : ' (missing)'), margin + 8, y);
      y += 7;
    });
  }

  y += 8;
  y = pdfSectionHeader(doc, 'Business Information', margin, y);

  const infoFields = [
    ['Name', auditData.name || auditData.business_name || 'N/A'],
    ['Address', auditData.address || auditData.city || 'N/A'],
    ['Phone', auditData.phone || 'N/A'],
    ['Website', auditData.website || (auditData.has_website ? 'Yes' : 'No') || 'N/A'],
    ['Category', auditData.category || 'N/A'],
  ];

  infoFields.forEach(field => {
    y = checkPageBreak(doc, y, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(95, 99, 104);
    doc.text(field[0] + ':', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(32, 33, 36);
    const val = doc.splitTextToSize(String(field[1]), contentWidth - 35);
    doc.text(val, margin + 35, y);
    y += val.length * 5 + 3;
  });

  // ========== PAGE 3: RECOMMENDATIONS ==========
  if (audit.recommendations && audit.recommendations.length > 0) {
    doc.addPage();
    y = 20;
    y = pdfSectionHeader(doc, 'Actionable Recommendations', margin, y);

    const recOrder = { critical: 0, warning: 1, good: 2 };
    const sortedRecs = [...audit.recommendations].sort((a, b) => (recOrder[a.severity] || 0) - (recOrder[b.severity] || 0));

    sortedRecs.forEach(rec => {
      y = checkPageBreak(doc, y, 14);
      const sevLabel = rec.severity.toUpperCase();
      let sevColor;
      if (rec.severity === 'critical') sevColor = [217, 48, 37];
      else if (rec.severity === 'warning') sevColor = [244, 180, 0];
      else sevColor = [13, 158, 108];

      doc.setFillColor(sevColor[0], sevColor[1], sevColor[2]);
      doc.circle(margin + 2, y - 1.5, 2, 'F');

      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(sevColor[0], sevColor[1], sevColor[2]);
      doc.text(sevLabel, margin + 7, y);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(32, 33, 36);
      const recLines = doc.splitTextToSize(rec.text, contentWidth - 10);
      doc.text(recLines, margin + 7, y + 5);
      y += 5 + recLines.length * 5 + 4;
    });
  }

  // ========== FOOTER ==========
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(`GMB Audit Report - ${bizName} - Page ${p} of ${pageCount}`, margin, 290);
  }

  // Download
  const filename = `GMB-Audit-${bizName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40)}.pdf`;
  doc.save(filename);
}

function pdfSectionHeader(doc, title, margin, y) {
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 115, 232);
  doc.text(title, margin, y);
  y += 3;
  doc.setDrawColor(26, 115, 232);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + doc.getTextWidth(title), y);
  y += 8;
  return y;
}

function checkPageBreak(doc, y, needed) {
  if (y + needed > 280) {
    doc.addPage();
    return 20;
  }
  return y;
}
