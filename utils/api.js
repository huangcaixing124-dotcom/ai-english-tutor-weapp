const CONFIG = require('./config');

/**
 * AI 对话 API
 * 发送用户文字，获取 AI 回复
 */
function sendChat(text, scenario, difficulty, history) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.apiBaseUrl + CONFIG.chatApi;
    console.log('[API] sendChat URL:', url);
    wx.request({
      url: url,
      method: 'POST',
      data: { text, scenario, difficulty, history },
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error('Chat API error: ' + res.statusCode));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/**
 * 语音识别 API
 * 上传音频文件，返回转写文字
 */
function sendAudioForSTT(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: CONFIG.apiBaseUrl + CONFIG.sttApi,
      filePath: tempFilePath,
      name: 'audio',
      header: { 'content-type': 'multipart/form-data' },
      success(res) {
        try {
          const data = JSON.parse(res.data);
          resolve(data.text);
        } catch {
          reject(new Error('STT parse error'));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/**
 * 语音合成 API
 * 传入文字，返回临时音频文件路径
 * 使用 wx.downloadFile 下载音频文件到临时目录
 */
function getTTSAudio(text) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.apiBaseUrl + CONFIG.ttsApi + '?text=' + encodeURIComponent(text);
    wx.downloadFile({
      url: url,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          resolve(res.tempFilePath);
        } else {
          reject(new Error('TTS download error: ' + res.statusCode));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

module.exports = {
  sendChat,
  sendAudioForSTT,
  getTTSAudio,
  sendVoiceForChat,
  lookupWord,
};

/**
 * 语音对话 API（语音进 → 语音出）
 * 上传音频，返回 AI 语音音频 + 文本信息
 * 返回：{ audioPath, userText, aiEnglish, aiChinese, aiCorrection }
 */
function sendVoiceForChat(tempFilePath, scenario, difficulty, history) {
  return new Promise((resolve, reject) => {
    const formData = { scenario, difficulty };
    if (history && history.length > 0) {
      formData.history = JSON.stringify(history);
    }
    wx.uploadFile({
      url: CONFIG.apiBaseUrl + '/api/voice',
      filePath: tempFilePath,
      name: 'audio',
      formData: formData,
      success(res) {
        try {
          const data = JSON.parse(res.data);
          if (data.error) {
            reject(new Error(data.error));
            return;
          }
          // data.audio 是 base64 编码的 MP3
          const fs = wx.getFileSystemManager();
          const tempPath = `${wx.env.USER_DATA_PATH}/voice_${Date.now()}.mp3`;
          const audioBuffer = wx.base64ToArrayBuffer(data.audio);
          fs.writeFile({
            filePath: tempPath,
            data: audioBuffer,
            success() {
              resolve({
                audioPath: tempPath,
                userText: data.userText || '',
                aiEnglish: data.aiEnglish || '',
                aiChinese: data.aiChinese || '',
                aiCorrection: data.aiCorrection || '',
              });
            },
            fail() {
              reject(new Error('Failed to save audio'));
            },
          });
        } catch (err) {
          reject(new Error('Voice API parse error'));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}

/**
 * 单词查询 API
 * 获取单词的音标、词性、释义、中文翻译
 */
function lookupWord(word) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: CONFIG.apiBaseUrl + '/api/word',
      method: 'POST',
      data: { word },
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          reject(new Error('Word lookup error: ' + res.statusCode));
        }
      },
      fail(err) {
        reject(err);
      },
    });
  });
}