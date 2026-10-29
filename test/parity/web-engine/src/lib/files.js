import * as XLSX from 'xlsx';

const toBase64 = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

// Browser File → payload the server can hand to Claude.
// PDFs and images go as base64 (Claude reads them natively); spreadsheets are flattened to CSV text.
export async function toPayload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return { fileName: file.name, mediaType: 'application/pdf', data: await toBase64(file) };
  if (ext === 'xlsx') {
    const wb = XLSX.read(await file.arrayBuffer());
    const text = wb.SheetNames.map(n => `## Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })).join('\n\n');
    return { fileName: file.name, mediaType: 'text/csv', text };
  }
  throw new Error(`“${file.name}” is not a PDF or an Excel (.xlsx) file.`);
}
