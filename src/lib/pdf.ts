import * as pdfjs from 'pdfjs-dist';

export async function extractTextFromPdf(file: File, onProgress?: (percent: number, currentPage: number, totalPages: number) => void): Promise<string> {
  // Set worker source lazily
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const totalPages = pdf.numPages;
  const pageTexts: string[] = new Array(totalPages);
  
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    
    pageTexts[i - 1] = pageText;
    
    if (onProgress) {
      onProgress(Math.round((i / totalPages) * 100), i, totalPages);
    }
  }
  
  return pageTexts.join('\n').trim();
}
