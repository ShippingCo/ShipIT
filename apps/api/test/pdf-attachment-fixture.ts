/** Tiny generated one-page PDF. No customer or external document bytes. */
export function invoicePdf() {
 let text='%PDF-1.4\n';const offsets=[0];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 objects.forEach((value,index)=>{offsets.push(Buffer.byteLength(text));text+=`${index+1} 0 obj\n${value}\nendobj\n`;});
 const xref=Buffer.byteLength(text);text+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(text);
}
