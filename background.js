// background.js

// --- 定数定義 ---
// APIキーはchrome.storage.localから取得するように変更
// const apiKey = 'AIzaSyANyTe-i94k13onqPUlSuzcYBGiQMDnOFs';

// systemPromptはchrome.storage.localから取得するように変更
// const systemPrompt = `
// あなたは、与えられた論文のテキスト情報から、指定されたフォーマットに従ってファイル名を生成する専門家です。
// ... (rest of the original prompt) ...
// `;

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';

// --- Offscreen Document 管理 ---
let creating;
async function hasOffscreenDocument() {
  const matchedClients = await clients.matchAll();
  return matchedClients.some(
    (c) => c.url === chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
  );
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['DOM_PARSER'],
      justification: 'PDF.jsライブラリでPDFのテキストを抽出するため',
    });
    await creating;
    creating = null;
  }
}

// --- メイン機能 ---

async function testGeminiAPI(prompt, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const requestData = {
      contents: [{ parts: [{ text: prompt }] }]
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'JSON形式のエラー情報がありませんでした。' }));
      console.error('APIからのエラー応答:', {
        status: response.status,
        statusText: response.statusText,
        body: errorData
      });
      throw new Error(`APIエラー: HTTPステータス ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      const aiResponse = data.candidates[0].content.parts[0].text;
      console.log('AIが生成したファイル名:', aiResponse);
      return aiResponse;
    } else {
      console.error('APIから正常な応答はありましたが、ファイル名が取得できませんでした。応答内容:', data);
      return null;
    }
  } catch (error) {
    console.error('Gemini APIの呼び出し処理自体でエラーが発生しました:', error.message);
    return null;
  }
}

async function getPdfText(url, pageCount) {
  await setupOffscreenDocument();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('PDFテキスト抽出がタイムアウトしました。'));
    }, 30000);
    const listener = (message) => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
      if (message.type === 'pdf-text-extracted') {
        resolve(message.text);
      } else if (message.type === 'pdf-text-error') {
        reject(new Error('Offscreen DocumentでのPDF解析に失敗: ' + message.error));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: 'extract-pdf-text', url: url });
  });
}

// --- イベントリスナー ---
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url) {
    console.error("アクティブなタブの情報が取得できませんでした。");
    return;
  }
  const url = tab.url;
  console.log('現在のURL:', url);

  // 処理開始を示すバッジを最初に設定
  chrome.action.setBadgeText({ text: '...' });
  chrome.action.setBadgeBackgroundColor({ color: '#FFA500' }); // オレンジ

  // 処理開始の通知
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icon128.png',
    title: 'PDF処理中',
    message: 'PDFのテキスト抽出とファイル名生成を開始します...',
    priority: 0
  });
  console.log('「PDF処理中」通知作成を試みました。');

  try {
    // chrome.storage.localからAPIキーとsystemPromptを取得
    const storedData = await chrome.storage.local.get(['userApiKey', 'systemPrompt', 'pdfPageCount']);
    const apiKey = storedData.userApiKey;
    // systemPromptが設定されていない場合のデフォルト値
    const currentSystemPrompt = storedData.systemPrompt || `
あなたは、与えられた論文のテキスト情報から、指定されたフォーマットに従ってファイル名を生成する専門家です。

## 入力
以降に続くコードブロック内のテキストが、PDFから抽出された論文の文字情報です。

## 出力フォーマット
出力は**ファイル名のみ**で、余分な説明やテキストは一切含めないでください。

ファイル名のフォーマットは以下のいずれかに従ってください。
- 著者が2人以上の場合: "{第一著者の名字}"_"{第二著者の名字}"_"{刊行年}"_"{タイトル}".pdf
- 著者が1人の場合: "{第一著者の名字}"_"{刊行年}"_"{タイトル}".pdf

## 各要素の抽出ルールと優先順位

1.  **"第一著者の名字"、"第二著者の名字"**
    *   入力テキストから著者名を特定し、テキストに最初に登場する1人または2人の著者名を抽出してください。
    *   抽出された著者名から「名字」を特定してください。名字の特定の具体的なルールはAIの判断に委ねます。
    *   著者が特定できない場合は、その要素を"不明"としてください。

2.  **"刊行年"**
    *   入力テキストから西暦4桁の数字（例: 2023）を刊行年として抽出してください。
    *   刊行年が特定できない場合は、その要素を"不明"としてください。

3.  **"タイトル"**
    *   入力テキストから論文のタイトルを特定してください。
    *   **日本語タイトル**: 抽出したタイトル全文をそのまま使用してください。
    *   **英語タイトル**:
        *   タイトルが英語であると判断した場合、CamelCase（またはPascalCase）形式に変換してください。
        *   半角スペースは全て削除し、各単語の先頭を大文字にしてください。
        *   ハイフン (-)、コロン (:), カンマ (,) などの記号は全て削除してください。
    *   日本語か英語かの判断はAIの判断に委ねます。
    *   タイトルが特定できない場合は、その要素を"不明"としてください。

---
`;

    // pdfPageCountが設定されていない場合のデフォルト値は1
    const pdfPageCount = storedData.pdfPageCount !== undefined ? storedData.pdfPageCount : 1; 

    if (!apiKey) {
      console.error("APIキーが設定されていません。オプションページを開きます。");

      // クエリパラメータ付きでオプションページを開く
      const optionsUrl = chrome.runtime.getURL('popup.html');
      chrome.tabs.create({ url: `${optionsUrl}?reason=no_api_key` });

      // バッジをクリア
      chrome.action.setBadgeText({ text: '' });
      return; // 処理を中断
    }

    const pdfText = await getPdfText(url, pdfPageCount);
    console.log('PDFテキスト抽出成功。');
    console.log('AIでファイル名を生成します...');
    const prompt = currentSystemPrompt + pdfText; // <--- Use the retrieved/default systemPrompt
    const aiGeneratedTitle = await testGeminiAPI(prompt, apiKey);
    if (!aiGeneratedTitle || typeof aiGeneratedTitle !== 'string' || aiGeneratedTitle.trim() === '') {
      console.error("AIによるファイル名生成に失敗、またはファイル名が空です。");
      return;
    }
    const trimmedTitle = aiGeneratedTitle.trim();
    const filename = trimmedTitle.endsWith('.pdf') ? trimmedTitle : `${trimmedTitle}.pdf`;
    console.log('最終的なファイル名:', filename);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("ダウンロードに失敗しました:", chrome.runtime.lastError.message);
      } else {
        console.log("ダウンロードを開始しました。 Download ID:", downloadId);
        chrome.action.setBadgeBackgroundColor({ color: '#008000' }); // 緑色
        chrome.action.setBadgeText({ text: '完了' });
        // 3秒後にバッジをクリア
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' });
        }, 3000);
      }
    });
  } catch (error) {
    console.error("処理に失敗しました:", error.message);
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }); // 赤色
    chrome.action.setBadgeText({ text: 'エラー' });
    // 3秒後にバッジをクリア
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' });
    }, 3000);
  }
});