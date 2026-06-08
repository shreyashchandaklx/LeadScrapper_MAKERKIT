import { jsPDF } from "jspdf";

/**
 * Generate a Google Business Profile audit PDF.
 *
 * Layout principles (rewritten 2026-06-03 — prior version had several
 * structural bugs: drawHeader() called addPage() even on page 1 producing
 * a leading blank page, bar-row labels overlapped the bar, sentiment was
 * rendered twice with conflicting colors, and the Next Steps table had
 * dead columns. All fixed below.)
 *
 *  - Page 1: header + Overall Score card + Score Breakdown + Executive Summary
 *  - Page 2: header + Profile Completeness checklist + Business Information
 *  - Page 3: header + Review & Sentiment + Recommendations + Next Steps
 *
 *  - One column, generous spacing, no overlapping text.
 *  - All colors passed to jsPDF as (r, g, b) separately — never as an array
 *    (passing an array throws "Invalid argument passed to jsPDF.f3").
 */
export function generateAuditPDF(auditData, audit) {
  const doc = new jsPDF("p", "mm", "a4");
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();

  // Layout constants — tuned for A4 (210 × 297 mm)
  const margin = 18;
  const contentWidth = pw - 2 * margin;
  const headerH = 28;                 // space reserved at top of every page
  const footerY = ph - 10;            // baseline of footer text
  const contentBottom = ph - 18;      // last y a section may safely write to

  const bizName = auditData.name || auditData.business_name || "Business";
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const overallScore = audit.score?.overall ?? 0;

  // Color helpers — all return [r, g, b] tuples; ALWAYS pass to jsPDF as
  // separate args.
  const COL = {
    blue:     [26, 115, 232],
    blueDark: [21, 90, 195],
    green:    [13, 158, 108],
    amber:    [244, 180, 0],
    red:      [217, 48, 37],
    text:     [30, 30, 30],
    label:    [110, 110, 110],
    rule:     [220, 220, 220],
    barBg:    [232, 234, 238],
    headerBg: [248, 250, 252],
  };
  const scoreCol =
    overallScore >= 80 ? COL.green
    : overallScore >= 60 ? COL.blue
    : overallScore >= 40 ? COL.amber
    : COL.red;

  const setFill  = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const setText  = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw  = (c) => doc.setDrawColor(c[0], c[1], c[2]);

  // ---------- header / footer ----------

  let pageNum = 0;
  function drawHeader() {
    // For pages after the first, advance.
    if (pageNum > 0) doc.addPage();
    pageNum += 1;

    setFill(COL.headerBg);
    doc.rect(0, 0, pw, headerH, "F");
    setFill(COL.blue);
    doc.rect(0, 0, pw, 2.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText(COL.label);
    doc.text("GOOGLE BUSINESS PROFILE AUDIT", margin, 11);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(COL.text);
    // Truncate businessName so it never collides with the right edge.
    const trimmed = bizName.length > 60 ? bizName.slice(0, 57) + "…" : bizName;
    doc.text(trimmed, margin, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setText(COL.label);
    doc.text("Prepared " + dateStr, margin, 24);

    // start drawing below the header
    return headerH + 6;
  }

  function checkPB(y, needed) {
    if (y + needed > contentBottom) {
      return drawHeader();
    }
    return y;
  }

  // ---------- reusable section blocks ----------

  function sectionTitle(y, text) {
    y = checkPB(y, 14);
    setFill(COL.blue);
    doc.rect(margin, y, contentWidth, 6.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setText([255, 255, 255]);
    doc.text(String(text).toUpperCase(), margin + 3, y + 4.6);
    return y + 11;
  }

  // Single horizontal bar with label on the left and "value/100" on the right
  // of the BAR (not the page).
  function barRow(y, label, value) {
    y = checkPB(y, 10);
    value = Math.max(0, Math.min(100, Number(value) || 0));

    const labelW = 60;                       // reserved width for label text
    const valueW = 18;                       // reserved for "100/100"
    const barX   = margin + labelW;
    const barW   = contentWidth - labelW - valueW;
    const barY   = y - 4;
    const barH   = 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(COL.text);
    doc.text(label, margin, y);

    setFill(COL.barBg);
    doc.rect(barX, barY, barW, barH, "F");

    const fillW = (value / 100) * barW;
    const c = value >= 70 ? COL.green : value >= 40 ? COL.amber : COL.red;
    if (fillW > 0) {
      setFill(c);
      doc.rect(barX, barY, fillW, barH, "F");
    }

    doc.setFont("helvetica", "bold");
    setText(COL.text);
    doc.text(String(value) + "/100", margin + contentWidth, y, { align: "right" });

    return y + 8;
  }

  // Two-column key/value row. Label fixed width on the left, value wraps.
  function fieldRow(y, label, value) {
    const labelW = 38;
    const valueX = margin + labelW;
    const valueW = contentWidth - labelW;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(COL.label);
    doc.text(label, margin, y);

    doc.setFont("helvetica", "normal");
    setText(COL.text);
    const lines = doc.splitTextToSize(String(value || "N/A"), valueW);
    doc.text(lines, valueX, y);

    return y + Math.max(6, lines.length * 4.6 + 2);
  }

  // ================================================================
  //  PAGE 1 — Overall Score + Breakdown + Executive Summary
  // ================================================================

  let y = drawHeader();

  // -- Overall Score card --
  const cardH = 42;
  setFill([245, 247, 250]);
  doc.rect(margin, y, contentWidth, cardH, "F");
  setDraw(COL.rule);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, contentWidth, cardH, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText(COL.label);
  doc.text("OVERALL AUDIT SCORE", margin + 5, y + 8);

  // Big score number — right-aligned inside a fixed 30mm zone so the
  // "/ 100" suffix always lands at a known x regardless of digit count.
  // (getTextWidth at 36pt under-reports slightly in jsPDF, which is what
  // caused "28/100" to visually collide before. Right-aligning the number
  // sidesteps the issue entirely.)
  doc.setFontSize(36);
  setText(scoreCol);
  const scoreStr = String(overallScore);
  const scoreRightX = margin + 32;          // score number ends here
  doc.text(scoreStr, scoreRightX, y + 30, { align: "right" });

  doc.setFontSize(13);
  setText([150, 150, 150]);
  doc.text("/ 100", scoreRightX + 3, y + 30);

  // Verdict on the right side of the card. Placed centered vertically and
  // far enough right that it never collides with the score block, even if
  // the score is "100" (3 digits).
  const verdict =
    overallScore >= 80 ? "Excellent"
    : overallScore >= 60 ? "Good"
    : overallScore >= 40 ? "Needs Improvement"
    : "Critical Issues";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  setText(scoreCol);
  doc.text(verdict, margin + contentWidth - 5, y + 22, { align: "right" });

  // Subtitle under the score
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setText(COL.label);
  doc.text("Out of 100 possible points", margin + 5, y + 36);

  y += cardH + 10;

  // -- Score Breakdown --
  y = sectionTitle(y, "Score Breakdown by Category");
  const comps = [
    ["Profile Completeness",
      audit.score?.components?.profile ?? audit.profile?.score ?? 0],
    ["Rating Score",
      audit.score?.components?.rating ??
        Math.min(100, Math.round((parseFloat(auditData.rating || 0)) * 20))],
    ["Review Volume",
      audit.score?.components?.reviews ??
        Math.min(100, (auditData.reviewCount || 0) * 3)],
    ["Photo Quality & Social",
      audit.score?.components?.photos ?? 0],
    ["Sentiment (Negative)",
      audit.score?.components?.sentiment ?? 100],
  ];
  comps.forEach(([label, val]) => { y = barRow(y, label, val); });
  y += 4;

  // -- Executive Summary --
  y = sectionTitle(y, "Executive Summary");
  const pos = audit.sentiment?.positive ?? 0;
  const tot = audit.sentiment?.total || 0;
  const neu = audit.sentiment?.neutral ?? 0;
  const neg = audit.sentiment?.negative ?? 0;
  const summary =
    `${bizName} scores ${overallScore}/100 in our comprehensive Google ` +
    `Business Profile audit. Profile completeness sits at ` +
    `${audit.profile?.score || 0}%. ` +
    (tot > 0
      ? `Sentiment analysis across ${tot} reviews shows ${pos}% positive, ` +
        `${neu}% neutral, and ${neg}% negative — providing a clear signal ` +
        `for where to focus the next 90 days of GBP work.`
      : "No reviews were available for sentiment analysis at the time of " +
        "this report. Building review volume should be the immediate priority.");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setText(COL.text);
  const sumLines = doc.splitTextToSize(summary, contentWidth);
  y = checkPB(y, sumLines.length * 5 + 4);
  doc.text(sumLines, margin, y);
  y += sumLines.length * 5 + 4;

  // ================================================================
  //  PAGE 2 — Profile Completeness + Business Information
  // ================================================================

  y = drawHeader();

  // -- Profile Completeness --
  const profScore = audit.profile?.score ?? 0;
  y = sectionTitle(y, `Profile Completeness — ${profScore}%`);

  // progress bar
  const pbY = y;
  setFill(COL.barBg);
  doc.rect(margin, pbY, contentWidth, 5, "F");
  const pf = Math.max(0, Math.min(contentWidth, (profScore / 100) * contentWidth));
  const pc = profScore >= 80 ? COL.green : profScore >= 50 ? COL.amber : COL.red;
  if (pf > 0) { setFill(pc); doc.rect(margin, pbY, pf, 5, "F"); }
  y += 11;

  // checklist
  const requiredItems = [
    "Business Name", "Business Address", "Business Category",
    "Business Hours", "Photos", "Phone Number", "Website",
  ];
  const present = {};
  (audit.profile?.checklist || []).forEach((it) => {
    present[it.label] = !!it.present;
  });

  requiredItems.forEach((item) => {
    y = checkPB(y, 7);
    const has = present[item] !== undefined ? present[item] : false;
    const tc = has ? COL.green : COL.red;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setText(tc);
    doc.text(has ? "✔" : "✗", margin, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(COL.text);
    doc.text(item, margin + 7, y);

    doc.setFont("helvetica", "bold");
    setText(tc);
    doc.text(has ? "Present" : "Missing", margin + contentWidth, y, { align: "right" });

    y += 6;
  });
  y += 6;

  // -- Business Information --
  y = sectionTitle(y, "Business Information");
  const addrParts = [auditData.address, auditData.city, auditData.state, auditData.zip]
    .filter(Boolean).join(", ");

  const infoList = [
    ["Business Name", auditData.name || auditData.business_name || "N/A"],
    ["Address",      addrParts || "N/A"],
    ["Phone",        auditData.phone || "Not provided — Action Required"],
    ["Website",      auditData.website
                       ? auditData.website
                       : auditData.has_website ? "Yes"
                       : "Not provided — Action Required"],
    ["Category",     auditData.category || "N/A"],
    ["Rating",       (auditData.rating != null ? String(auditData.rating) : "N/A") +
                     (auditData.reviewCount ? `  (${auditData.reviewCount} reviews)` : "")],
  ];
  infoList.forEach(([k, v]) => { y = fieldRow(y, k, v); });

  // ================================================================
  //  PAGE 3 — Sentiment + Recommendations + Next Steps
  // ================================================================

  y = drawHeader();

  // -- Review & Sentiment --
  y = sectionTitle(y, "Review & Sentiment Analysis");

  const totReviews = auditData.reviewCount || audit.sentiment?.total || 0;
  const avgr = auditData.rating || 0;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setText(COL.text);
  doc.text(
    `Google Reviews — ${totReviews} reviews   |   Avg rating ${avgr}   |   Response rate: 0%`,
    margin, y
  );
  y += 8;

  // ONE clean sentiment block — NOT the old "render twice" pattern.
  [
    ["Positive", pos, COL.green],
    ["Neutral",  neu, COL.amber],
    ["Negative", neg, COL.red],
  ].forEach(([label, val, c]) => {
    y = checkPB(y, 9);
    // colored swatch + label
    setFill(c);
    doc.rect(margin, y - 3.5, 3, 3, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(COL.text);
    doc.text(label, margin + 6, y);
    // bar
    const lblW = 30;
    const valW = 14;
    const bx = margin + lblW;
    const bw = contentWidth - lblW - valW;
    setFill(COL.barBg);
    doc.rect(bx, y - 3, bw, 4, "F");
    const fw = Math.max(0, Math.min(bw, (val / 100) * bw));
    if (fw > 0) { setFill(c); doc.rect(bx, y - 3, fw, 4, "F"); }
    // percentage
    doc.setFont("helvetica", "bold");
    setText(c);
    doc.text(val + "%", margin + contentWidth, y, { align: "right" });
    y += 7;
  });
  y += 4;

  // -- Recommendations --
  y = sectionTitle(y, "Actionable Recommendations");
  const sevRank = { critical: 0, warning: 1, info: 2, good: 3 };
  const sevCol = {
    critical: COL.red,
    warning:  COL.amber,
    info:     COL.blue,
    good:     COL.green,
  };
  const recs = (audit.recommendations || []).slice()
    .sort((a, b) => (sevRank[a.severity] || 0) - (sevRank[b.severity] || 0));

  const badgeW = 22;
  recs.forEach((rec) => {
    const sev = (rec.severity || "info").toLowerCase();
    const sevColor = sevCol[sev] || COL.blue;
    const text = rec.text || rec.title || rec.message || rec.description || "";
    const lines = doc.splitTextToSize(text, contentWidth - badgeW - 4);
    const blockH = Math.max(7, lines.length * 4.5 + 2);

    y = checkPB(y, blockH + 3);

    // badge
    setFill(sevColor);
    doc.rect(margin, y - 4, badgeW, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    setText([255, 255, 255]);
    doc.text(sev.toUpperCase(), margin + badgeW / 2, y - 0.5, { align: "center" });

    // text
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setText(COL.text);
    doc.text(lines, margin + badgeW + 4, y);

    y += blockH + 2;
  });

  if (!recs.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setText(COL.label);
    doc.text("No specific recommendations were generated for this audit.", margin, y);
    y += 8;
  }

  // -- Next Steps table --
  y += 2;
  y = sectionTitle(y, "Recommended Next Steps");

  const colNumW  = 9;
  const colPrioW = 30;
  const colActW  = contentWidth - colNumW - colPrioW;
  const xNum  = margin;
  const xAct  = margin + colNumW;
  const xPrio = margin + colNumW + colActW;

  // header row
  y = checkPB(y, 8);
  setFill(COL.blue);
  doc.rect(margin, y - 4, contentWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setText([255, 255, 255]);
  doc.text("#",        xNum + colNumW / 2,  y, { align: "center" });
  doc.text("ACTION",   xAct + 2,            y);
  doc.text("PRIORITY", xPrio + colPrioW / 2, y, { align: "center" });
  y += 5;

  const defaultSteps = [
    { action: "Add business phone number and website", priority: "Critical" },
    { action: "Add or verify business hours",          priority: "Critical" },
    { action: "Request reviews from satisfied customers", priority: "High" },
    { action: "Upload 10+ new photos of work, team, premises", priority: "High" },
    { action: "Respond to all existing reviews",       priority: "Medium" },
    { action: "Add description with targeted service keywords", priority: "Medium" },
    { action: "Enable messaging and respond within 24 hours", priority: "High" },
    { action: "Post updates bi-weekly with Google Business Profile", priority: "Medium" },
    { action: "Verify address, category, and hours",   priority: "High" },
    { action: "Add Services section with detailed service list", priority: "Medium" },
  ];
  const steps = (audit.nextSteps && audit.nextSteps.length)
    ? audit.nextSteps : defaultSteps;

  const prioCol = {
    Critical: COL.red,
    High:     COL.amber,
    Medium:   [110, 110, 110],
    Low:      [160, 160, 160],
  };

  steps.forEach((step, i) => {
    const pr = step.priority || "Medium";
    const actLines = doc.splitTextToSize(step.action || "", colActW - 4);
    const rowH = Math.max(7, actLines.length * 4.5 + 2);

    y = checkPB(y, rowH);

    // alternating row background
    if (i % 2 === 0) {
      setFill([249, 250, 251]);
      doc.rect(margin, y - 4, contentWidth, rowH, "F");
    }

    // separator
    setDraw(COL.rule);
    doc.setLineWidth(0.2);
    doc.line(margin, y - 4 + rowH, margin + contentWidth, y - 4 + rowH);

    // number
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setText(COL.text);
    doc.text(String(i + 1), xNum + colNumW / 2, y, { align: "center" });

    // action text
    doc.setFont("helvetica", "normal");
    setText(COL.text);
    doc.text(actLines, xAct + 2, y);

    // priority pill
    const pc2 = prioCol[pr] || prioCol.Medium;
    setFill(pc2);
    const pillW = 22, pillX = xPrio + (colPrioW - pillW) / 2;
    doc.roundedRect(pillX, y - 3.5, pillW, 5, 1, 1, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setText([255, 255, 255]);
    doc.text(pr.toUpperCase(), pillX + pillW / 2, y, { align: "center" });

    y += rowH;
  });

  // ---------- footer on every page ----------
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setDraw(COL.rule);
    doc.setLineWidth(0.2);
    doc.line(margin, footerY - 4, margin + contentWidth, footerY - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setText([140, 140, 140]);
    doc.text(`${bizName}  •  GBP Audit  •  ${dateStr}`, margin, footerY);
    doc.text(`Page ${p} of ${totalPages}`, margin + contentWidth, footerY, { align: "right" });
  }

  return doc;
}
