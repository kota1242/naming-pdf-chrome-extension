
// popup.js

// ページ内のテキストを国際化(i18n)対応の文言に置き換える
function localizeHTML() {
  // タイトル
  document.title = chrome.i18n.getMessage('popupTitle');

  // data-i18n属性を持つすべての要素を検索してテキストを設定
  const i18nElements = document.querySelectorAll('[data-i18n]');
  i18nElements.forEach(el => {
    el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
  });

  // プレースホルダーなど、属性値を設定
  document.getElementById('api-key-input').placeholder = chrome.i18n.getMessage('apiKeyPlaceholder');

  // HTMLを含む可能性のある要素（リンクなど）
  const feedbackElement = document.querySelector('[data-i18n-html="feedbackText"]');
  if (feedbackElement) {
    const prefix = chrome.i18n.getMessage('feedbackTextPrefix');
    const linkText = chrome.i18n.getMessage('feedbackLinkText');
    const suffix = chrome.i18n.getMessage('feedbackTextSuffix');
    feedbackElement.innerHTML = `${prefix}<a href="https://docs.google.com/forms/d/e/1FAIpQLSdxCMzlN0ArQhYDqX1Sig_DYFGgTMUPQYZxtKq9_O5lBTM3iQ/viewform?usp=sharing&ouid=110726981741186857367" target="_blank">${linkText}</a>${suffix}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // まずページ全体の文言をローカライズ
  localizeHTML();

  // --- 定数定義 ---

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
      
      const currentPrompt = result.systemPrompt || chrome.i18n.getMessage('systemPrompt');
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
    systemPromptInput.value = chrome.i18n.getMessage('systemPrompt');
  });

  // 「保存して閉じる」ボタンのクリック処理
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const systemPrompt = systemPromptInput.value.trim();
    const pdfPageCount = parseInt(pdfPageCountInput.value, 10);

    if (!apiKey) {
      messageArea.textContent = chrome.i18n.getMessage('errorApiKeyRequired');
      messageArea.style.display = 'block';
      return;
    }
    
    if (isNaN(pdfPageCount) || pdfPageCount < 1) {
      messageArea.textContent = chrome.i18n.getMessage('errorInvalidPageCount');
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
    messageArea.textContent = chrome.i18n.getMessage('statusApiKeyMissing');
    messageArea.style.display = 'block';
  }

  // ページ読み込み時に設定をロード
  loadSettings();
});
