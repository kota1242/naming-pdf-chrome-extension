// offscreen.js

// pdf.jsライブラリをインポート
import * as pdfjsLib from './pdfjs-dist/build/pdf.mjs';

// Workerファイルの場所を指定
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs-dist/build/pdf.worker.mjs');

// background.jsからのメッセージを受け取るリスナー
chrome.runtime.onMessage.addListener(async (message) => {
  // メッセージのタイプが'extract-pdf-text'であるかを確認
  if (message.type === 'extract-pdf-text') {
    const url = message.url;
    const pageCount = message.pageCount || 1; // pageCountを取得。なければデフォルト1
    
    try {
      // PDFをロード
      const pdf = await pdfjsLib.getDocument(url).promise;
      let fullText = '';

      // 指定されたページ数分ループしてテキストを抽出
      for (let i = 1; i <= pageCount; i++) {
        if (i > pdf.numPages) { // PDFの総ページ数を超えたら終了
          break;
        }
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n'; // 各ページのテキストを連結
      }
      
      // 成功したら、抽出したテキストをbackground.jsに送り返す
      chrome.runtime.sendMessage({ type: 'pdf-text-extracted', text: fullText });
    } catch (error) {
      // 失敗したら、エラー情報をbackground.jsに送り返す
      chrome.runtime.sendMessage({ type: 'pdf-text-error', error: error.message });
    }
  }
});