// offscreen.js

// pdf.jsライブラリをインポート
import * as pdfjsLib from './pdfjs-dist/build/pdf.mjs';

// 可能なら詳細ログを有効化（3: errors+warns+infos）
try {
  if (typeof pdfjsLib.setVerbosityLevel === 'function') {
    pdfjsLib.setVerbosityLevel(3);
  }
} catch (_) {}

// Worker 初期化（ESMビルドでは workerSrc が無視される場合があるため workerPort を優先）
try {
  const workerUrl = chrome.runtime.getURL('pdfjs-dist/build/pdf.worker.mjs');
  // type: 'module' を指定してモジュールワーカーとして読み込む
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
} catch (_) {
  // フォールバック（古いビルド用）：classic worker を探すコードがある場合に備えて設定は残す
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs-dist/build/pdf.worker.mjs');
  // それでも問題が出る環境ではワーカーを無効化（メインスレッドで実行）
  try { pdfjsLib.GlobalWorkerOptions.disableWorker = true; } catch (_) {}
}

// 予期せぬエラーを background に転送
window.addEventListener('error', (e) => {
  try {
    chrome.runtime.sendMessage({
      type: 'offscreen-error',
      error: e.message,
      stack: e.error && e.error.stack ? e.error.stack : undefined,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
    });
  } catch (_) {}
});

window.addEventListener('unhandledrejection', (e) => {
  try {
    const reason = e.reason || {};
    chrome.runtime.sendMessage({
      type: 'offscreen-error',
      error: typeof reason === 'string' ? reason : reason.message,
      stack: reason && reason.stack ? reason.stack : undefined,
    });
  } catch (_) {}
});

// console.error を background にも転送して可視化
try {
  const originalConsoleError = console.error;
  console.error = (...args) => {
    try {
      chrome.runtime.sendMessage({ type: 'offscreen-log', level: 'error', args: args.map(String) });
    } catch (_) {}
    try { originalConsoleError.apply(console, args); } catch (_) {}
  };
} catch (_) {}

// Base64デコード用のヘルパー関数
function base64ToUint8Array(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

// background.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'extract-pdf-text') {
    const base64PdfData = message.base64PdfData;
    const pageCount = message.pageCount || 1;

    try {
      // Base64をUint8Arrayにデコード
      const pdfData = base64ToUint8Array(base64PdfData);
      console.log('offscreen.js: デコード後のPDFデータサイズ:', pdfData.byteLength); // ★デバッグログ

      const pdf = await pdfjsLib.getDocument({
        data: pdfData, // デコードしたデータを渡す
        cMapUrl: chrome.runtime.getURL('pdfjs-dist/cmaps/'),
        cMapPacked: true,
        isEvalSupported: false,
      }).promise;

      let fullText = '';

      // 指定されたページ数分ループしてテキストを抽出
      const numPagesToExtract = Math.min(pageCount, pdf.numPages);
      for (let i = 1; i <= numPagesToExtract; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n';
      }

      // 成功したら、抽出したテキストをbackground.jsに送り返す
      chrome.runtime.sendMessage({ type: 'pdf-text-extracted', text: fullText });
    } catch (error) {
      console.error('Error parsing PDF in offscreen document:', error);
      // 失敗したら、エラー情報をbackground.jsに送り返す
      chrome.runtime.sendMessage({
        type: 'pdf-text-error',
        error: error && error.message ? error.message : String(error),
        name: error && error.name ? error.name : undefined,
        stack: error && error.stack ? error.stack : undefined,
      });
    }
  }
});