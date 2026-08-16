import { pdfjs } from 'react-pdf';

// Standard Vite recipe: pdfjs needs its worker script served as a URL it can
// spawn a Worker from, rather than bundled inline.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();
