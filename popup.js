
// popup.js

document.addEventListener('DOMContentLoaded', () => {

  // --- 定数定義 ---
  const DEFAULT_SYSTEM_PROMPT = `あなたは、与えられた論文のテキスト情報から、指定されたフォーマットに従ってファイル名を生成する専門家です。

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

---`;

  // --- HTML要素の取得 ---
  const messageArea = document.getElementById('message-area');
  const apiKeyInput = document.getElementById('api-key-input');
  const pdfPageCountInput = document.getElementById('pdf-page-count-input');

  // プロンプト関連の要素
  const promptDisplayArea = document.getElementById('prompt-display-area');
  const promptDisplayContent = document.getElementById('prompt-display-content');
  const editPromptButton = document.getElementById('edit-prompt-button');
  
  const promptEditArea = document.getElementById('prompt-edit-area');
  const systemPromptInput = document.getElementById('system-prompt-input');
  const resetPromptButton = document.getElementById('reset-prompt-button');

  const saveButton = document.getElementById('save-button');

  // --- 関数定義 ---

  // UIの状態を「表示モード」にする
  function setDisplayMode(currentPrompt) {
    promptDisplayContent.textContent = currentPrompt;
    promptDisplayArea.style.display = 'block';
    promptEditArea.style.display = 'none';
  }

  // UIの状態を「編集モード」にする
  function setEditMode(currentPrompt) {
    systemPromptInput.value = currentPrompt;
    promptDisplayArea.style.display = 'none';
    promptEditArea.style.display = 'block';
  }

  // 設定を読み込んでUIに反映する
  function loadSettings() {
    chrome.storage.local.get(['userApiKey', 'systemPrompt', 'pdfPageCount'], (result) => {
      apiKeyInput.value = result.userApiKey || '';
      pdfPageCountInput.value = result.pdfPageCount !== undefined ? result.pdfPageCount : 1;
      
      const currentPrompt = result.systemPrompt || DEFAULT_SYSTEM_PROMPT;
      setDisplayMode(currentPrompt);
    });
  }

  // --- イベントリスナー設定 ---

  // 「編集」ボタンのクリック処理
  editPromptButton.addEventListener('click', () => {
    const currentPrompt = promptDisplayContent.textContent;
    setEditMode(currentPrompt);
  });

  // 「デフォルトに戻す」ボタンのクリック処理
  resetPromptButton.addEventListener('click', () => {
    systemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
  });

  // 「保存して閉じる」ボタンのクリック処理
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const systemPrompt = systemPromptInput.value.trim();
    const pdfPageCount = parseInt(pdfPageCountInput.value, 10);

    if (!apiKey) {
      messageArea.textContent = 'APIキーは必須です。';
      messageArea.style.display = 'block';
      return;
    }
    
    if (isNaN(pdfPageCount) || pdfPageCount < 1) {
      messageArea.textContent = 'PDF読み込みページ数は1以上の数値を入力してください。';
      messageArea.style.display = 'block';
      return;
    }

    const dataToSave = {
      userApiKey: apiKey,
      systemPrompt: systemPrompt,
      pdfPageCount: pdfPageCount
    };

    chrome.storage.local.set(dataToSave, () => {
      console.log('設定が保存されました:', dataToSave);
      // 保存が完了したら、タブを閉じる
      chrome.tabs.getCurrent((tab) => {
        if (tab) {
          chrome.tabs.remove(tab.id);
        }
      });
    });
  });

  // --- 初期化処理 ---

  // クエリパラメータをチェックしてメッセージを表示
  const urlParams = new URLSearchParams(window.location.search);
  const reason = urlParams.get('reason');
  if (reason === 'no_api_key') {
    messageArea.textContent = 'APIキーが設定されていません。キーを保存してください。';
    messageArea.style.display = 'block';
  }

  // ページ読み込み時に設定をロード
  loadSettings();
});
