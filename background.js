// background.js

// --- 定数定義 ---

const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

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

async function generateFilenameWithGemini(systemPrompt, userPrompt, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`; 
    const requestData = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        parts: [{ text: userPrompt }]
      }]
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'レスポンスがJSON形式ではありませんでした。' }));
      
      // APIから返されたエラーオブジェクトを、整形された読みやすいテキスト形式でコンソールに出力します。
      console.error('APIからの詳細なエラー応答:', JSON.stringify(errorData, null, 2));
      
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

// Base64エンコード用のヘルパー関数
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function getPdfText(pdfData, pageCount) {
  await setupOffscreenDocument();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('PDFテキスト抽出がタイムアウトしました。'));
    }, 30000);
    const listener = (message) => {
      // リスナーは一度しか使わないので、タイプをチェックしてすぐに削除
      if (message.type === 'pdf-text-extracted' || message.type === 'pdf-text-error' || message.type === 'offscreen-error') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        if (message.type === 'pdf-text-extracted') {
          resolve(message.text);
        } else if (message.type === 'pdf-text-error') {
          reject(new Error('Offscreen DocumentでのPDF解析に失敗: ' + message.error));
        } else { // offscreen-error
          console.error('Offscreen ドキュメント実行時エラー:', message);
          reject(new Error(`Offscreen 実行エラー: ${message.error || '詳細不明'}`));
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    // ArrayBufferをBase64文字列に変換して送信
    const base64PdfData = arrayBufferToBase64(pdfData);
    chrome.runtime.sendMessage({ type: 'extract-pdf-text', base64PdfData: base64PdfData, pageCount });
  });
}

// HTMLタグを削除するヘルパー関数
function stripHtmlTags(str) {
  return str.replace(/<[^>]*>/g, '');
}

// Offscreen からのログを背景側に転送して見える化
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'offscreen-log') {
    try {
      console.error('[offscreen]', ...(Array.isArray(message.args) ? message.args : [message.args]));
    } catch (_) {
      // どうしても展開できない場合はそのまま出力
      console.error('[offscreen]', message);
    }
  }
});

// 通知表示とロギングのためのヘルパー関数
function showNotification(title, message, priority = 0) {
  const notificationId = `pdf-namer-notification-${Date.now()}`;
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/icon128.png',
    title: title,
    message: message,
    priority: priority
  }, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error(`通知の作成に失敗しました: ${chrome.runtime.lastError.message}`, {id: createdId});
    } else {
      console.log(`通知を作成しました: ${createdId}`);
    }
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
  showNotification(
    chrome.i18n.getMessage('notificationProcessingTitle'),
    chrome.i18n.getMessage('notificationProcessingMessage')
  );

  try {
    // 1. APIキーと設定を取得
    const storedData = await chrome.storage.local.get(['userApiKey', 'systemPrompt', 'pdfPageCount']);
    const apiKey = storedData.userApiKey;
    // ストレージにsystemPromptがあればそれを使用し、なければデフォルトのプロンプト（messages.jsonから取得）を使用
    const currentSystemPrompt = storedData.systemPrompt || chrome.i18n.getMessage('systemPrompt');
    const pdfPageCount = storedData.pdfPageCount !== undefined ? storedData.pdfPageCount : 1;

    if (!apiKey) {
      // APIキー未設定の場合、通知してオプションページを開く
      showNotification(
        chrome.i18n.getMessage('notificationApiKeyRequiredTitle'),
        chrome.i18n.getMessage('notificationApiKeyRequiredMessage'),
        2
      );
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') + '?reason=no_api_key' });
      // バッジのテキストと色を両方クリアして、処理が完了したことをユーザーに示す
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: null });
      throw new Error("APIキーが設定されていません。");
    }

    // 2. PDFデータを取得・検証
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`PDFのダウンロードに失敗しました: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/pdf')) {
      throw new Error('対象のURLはPDFファイルではありません。');
    }
    const pdfData = await response.arrayBuffer();
    // console.log('background.js: PDFデータサイズ:', pdfData.byteLength); // デバッグ完了のためコメントアウト

    // 3. OffscreenでPDFテキストを抽出
    const pdfText = await getPdfText(pdfData, pdfPageCount);

    // Gemini APIでファイル名を生成
    const aiGeneratedTitle = await generateFilenameWithGemini(currentSystemPrompt, pdfText, apiKey);

    if (!aiGeneratedTitle || typeof aiGeneratedTitle !== 'string' || aiGeneratedTitle.trim() === '') {
      throw new Error("AIによるファイル名生成に失敗、またはファイル名が空です。");
    }

    const cleanedTitle = stripHtmlTags(aiGeneratedTitle);
    if (cleanedTitle.trim() === '') {
      throw new Error("AIによるファイル名生成に失敗、またはファイル名が空です。");
    }

    // 5. ファイルをダウンロード
    const trimmedTitle = cleanedTitle.trim();
    const filename = trimmedTitle.endsWith('.pdf') ? trimmedTitle : `${trimmedTitle}.pdf`;
    console.log('最終的なファイル名:', filename);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("ダウンロードに失敗しました:", chrome.runtime.lastError.message);
        // ダウンロード失敗の通知
        showNotification(
          chrome.i18n.getMessage('notificationDownloadFailedTitle'),
          chrome.i18n.getMessage('notificationDownloadFailedMessage', [chrome.runtime.lastError.message]),
          2
        );
      } else {
        console.log("ダウンロードを開始しました。 Download ID:", downloadId);
        chrome.action.setBadgeBackgroundColor({ color: '#008000' }); // 緑色
        chrome.action.setBadgeText({ text: '完了' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
      }
    });

  } catch (error) {
    console.error("処理に失敗しました:", error.message);

    // エラー内容に応じた通知メッセージを生成
    let notificationTitle = chrome.i18n.getMessage('notificationGenericErrorTitle');
    let notificationMessage = error.message;

    if (error.message.includes('対象のURLはPDFファイルではありません')) {
      notificationTitle = chrome.i18n.getMessage('notificationPdfNotFoundTitle');
      notificationMessage = chrome.i18n.getMessage('notificationPdfNotFoundMessage');
    } else if (error.message.includes('PDFのダウンロードに失敗しました')) {
      notificationTitle = chrome.i18n.getMessage('notificationPdfFetchFailedTitle');
      notificationMessage = chrome.i18n.getMessage('notificationPdfFetchFailedMessage');
    } else if (error.message.includes('Offscreen DocumentでのPDF解析に失敗')) {
      notificationTitle = chrome.i18n.getMessage('notificationPdfParseErrorTitle');
      notificationMessage = chrome.i18n.getMessage('notificationPdfParseErrorMessage');
    } else if (error.message.includes('AIによるファイル名生成に失敗') || error.message.includes('APIエラー')) {
      notificationTitle = chrome.i18n.getMessage('notificationAiErrorTitle');
      notificationMessage = chrome.i18n.getMessage('notificationAiErrorMessage');
    } else if (error.message.includes('APIキーが設定されていません')) {
      // このケースはtryブロック内で既に通知済みなので、ここでは何もしない
      return;
    }

    // 汎用エラー通知を作成
    showNotification(notificationTitle, notificationMessage, 2);

    // バッジをエラー表示に設定
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }); // 赤色
    chrome.action.setBadgeText({ text: 'エラー' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000); // 少し長めに表示
  }
});