// ═══════════════════════════════════════
// 项目配置
// ═══════════════════════════════════════

const CONFIG = {
  // 项目名称
  projectName: 'ai-english-tutor',

  // API 地址
  apiBaseUrl: 'https://english.hcxserver.xyz',

  // 开发模式
  isDev: false,

  // AI 对话 API
  chatApi: '/api/chat',

  // 语音识别 API（上传音频，返回文字）
  sttApi: '/api/stt',

  // 语音合成 API（传入文字，返回音频文件）
  ttsApi: '/api/tts',
};

// 自动切换开发/生产地址
if (CONFIG.isDev) {
  CONFIG.apiBaseUrl = 'http://localhost:3002';
}

module.exports = CONFIG;