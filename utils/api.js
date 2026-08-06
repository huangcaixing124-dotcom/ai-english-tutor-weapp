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
 */
function getTTSAudio(text) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: CONFIG.apiBaseUrl + CONFIG.ttsApi,
      method: 'POST',
      data: { text },
      header: { 'content-type': 'application/json' },
      responseType: 'arraybuffer',
      success(res) {
        if (res.statusCode === 200) {
          // 将音频数据写入临时文件
          const fs = wx.getFileSystemManager();
          const tempPath = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`;
          fs.writeFile({
            filePath: tempPath,
            data: res.data,
            success() {
              resolve(tempPath);
            },
            fail() {
              reject(new Error('Failed to save audio file'));
            },
          });
        } else {
          reject(new Error('TTS API error: ' + res.statusCode));
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
  lookupWord,
};

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