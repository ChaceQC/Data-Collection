import { PDFDocument, PDFName } from "pdf-lib";

export async function makeRangePdf(large = false) {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("FIRST PAGE", { x: 48, y: 700, size: 20 });
  if (large) {
    const padding = pdf.context.register(pdf.context.stream(new Uint8Array(2 * 1024 * 1024).fill(42)));
    pdf.catalog.set(PDFName.of("SyntheticFixture"), padding);
  }
  pdf.addPage().drawText("LAST PAGE CONTENT", { x: 48, y: 700, size: 20 });
  return pdf.save({ useObjectStreams: false });
}
