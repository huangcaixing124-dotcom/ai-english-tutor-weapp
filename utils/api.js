const CONFIG = require('./config');

/**
 * AI 对话 API
 * 发送用户文字，获取 AI 回复
 */
function sendChat(text, scenario, difficulty, history, profile) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.apiBaseUrl + CONFIG.chatApi;
    console.log('[API] sendChat URL:', url);
    wx.request({
      url: url,
      method: 'POST',
      data: { text, scenario, difficulty, history, profile },
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
  sendVoiceForChatStream,
};

/**
 * 语音对话 API（语音进 → 语音出）
 * 上传音频，返回 AI 语音音频 + 文本信息
 * 返回：{ audioPath, userText, aiEnglish, aiChinese, aiCorrection }
 */
function sendVoiceForChat(tempFilePath, scenario, difficulty, history, profile) {
  return new Promise((resolve, reject) => {
    const formData = { scenario, difficulty };
    if (history && history.length > 0) {
      formData.history = JSON.stringify(history);
    }
    // 用户画像（长期记忆），后端可注入 system prompt
    if (profile) {
      formData.profile = profile;
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

/**
 * 流式语音对话 API（WebSocket 版）
 * 边录边发 PCM 帧，流式接收 AI 回复和音频
 *
 * callbacks 支持：
 *   onStt(text)       - 语音识别结果
 *   onAiChunk(text)   - AI 流式输出片段
 *   onAiDone(result)  - AI 完整回复
 *   onAudio(arrayBuffer) - 音频数据块
 *   onTtsDone()        - TTS 完成
 *   onError(err)       - 错误
 *   onClose()          - 连接关闭
 *
 * 返回一个对象：{ sendPcm(frame), sendEnd(), close() }
 */
function sendVoiceForChatStream(callbacks = {}) {
  const url = 'wss://api-backup.hcxserver.xyz';
  let socketTask = null;
  let connected = false;

  // 连接 WebSocket
  socketTask = wx.connectSocket({
    url: url,
    success() {
      console.log('[WS] connecting...');
    },
    fail(err) {
      console.error('[WS] connect error:', err);
      if (callbacks.onError) callbacks.onError(err);
    },
  });

  socketTask.onOpen(() => {
    console.log('[WS] connected');
    connected = true;
    // 发送 ping 保持连接
    keepAlive();
  });

  socketTask.onMessage((res) => {
    try {
      // 判断是二进制还是文本
      if (res.data instanceof ArrayBuffer) {
        // 二进制帧：音频数据
        if (callbacks.onAudio) callbacks.onAudio(res.data);
      } else {
        // 文本帧：JSON
        const msg = JSON.parse(res.data);
        switch (msg.type) {
          case 'config_ack':
            console.log('[WS] config acknowledged');
            break;
          case 'stt':
            if (callbacks.onStt) callbacks.onStt(msg.text);
            break;
          case 'ai_chunk':
            if (callbacks.onAiChunk) callbacks.onAiChunk(msg.text);
            break;
          case 'ai_done':
            if (callbacks.onAiDone) callbacks.onAiDone({
              aiEnglish: msg.english,
              aiChinese: msg.chinese,
              aiCorrection: msg.correction,
            });
            break;
          case 'tts_done':
            if (callbacks.onTtsDone) callbacks.onTtsDone();
            break;
          case 'error':
            if (callbacks.onError) callbacks.onError(new Error(msg.message));
            break;
          case 'pong':
            break;
        }
      }
    } catch (e) {
      console.error('[WS] parse error:', e);
    }
  });

  socketTask.onError((err) => {
    console.error('[WS] error:', err);
    if (callbacks.onError) callbacks.onError(err);
  });

  socketTask.onClose(() => {
    console.log('[WS] closed');
    connected = false;
    if (callbacks.onClose) callbacks.onClose();
  });

  // 心跳保持连接
  let heartbeatTimer = null;
  function keepAlive() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (connected) {
        socketTask.send({ data: JSON.stringify({ type: 'ping' }) });
      } else {
        clearInterval(heartbeatTimer);
      }
    }, 30000);
  }

  return {
    /**
     * 发送配置
     */
    sendConfig(scenario, difficulty, history) {
      socketTask.send({
        data: JSON.stringify({
          type: 'config',
          scenario,
          difficulty,
          history: history || [],
        }),
      });
    },

    /**
     * 发送 PCM 帧（边录边发）
     */
    sendPcm(frameBuffer) {
      if (!connected) return;
      socketTask.send({
        data: frameBuffer,
      });
    },

    /**
     * 标记用户说完，开始处理
     */
    sendEnd() {
      if (!connected) return;
      socketTask.send({
        data: JSON.stringify({ type: 'end' }),
      });
    },

    /**
     * 关闭连接
     */
    close() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (connected) {
        socketTask.close();
      }
    },
  };
}