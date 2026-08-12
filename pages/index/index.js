const API = require('../../utils/api');

const CHARACTER_STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  CORRECTING: 'correcting',
  HAPPY: 'happy',
};

// 氛围光颜色映射（状态 → 背景渐变色）
const AMBIENT_COLORS = {
  idle: 'rgba(0, 122, 255, 0.35)',
  listening: 'rgba(90, 200, 250, 0.38)',
  thinking: 'rgba(255, 149, 0, 0.38)',
  speaking: 'rgba(52, 199, 89, 0.38)',
  happy: 'rgba(255, 214, 10, 0.38)',
  correcting: 'rgba(175, 82, 222, 0.38)',
};

const SCENARIOS = [
  {
    id: 'free', label: '💬 Free Talk', labelCn: '自由对话',
    welcomeEnglish: "Hi there! I'm your AI English tutor. Tap the microphone button and start speaking — I understand both English and Chinese!",
    welcomeChinese: '你好！我是你的 AI 英语口语教练。点击麦克风按钮开始说话吧——中英文都可以！',
  },
  {
    id: 'restaurant', label: '🍽️ Restaurant', labelCn: '餐厅',
    welcomeEnglish: "Welcome to our restaurant! I'll be your waiter today. Just tap the mic and tell me what you'd like to order!",
    welcomeChinese: '欢迎来到我们的餐厅！今天我是你的服务员。点击麦克风告诉我你想点什么！',
  },
  {
    id: 'interview', label: '💼 Interview', labelCn: '面试',
    welcomeEnglish: "Welcome to the interview. I'm the hiring manager. Let's start — could you please introduce yourself and tell me about your background?",
    welcomeChinese: '欢迎参加面试。我是招聘经理。请开始吧——你能介绍一下自己和你的背景吗？',
  },
  {
    id: 'travel', label: '✈️ Travel', labelCn: '旅行',
    welcomeEnglish: "Hello! I'm your travel assistant. Are you planning a trip? I can help you with airport check-in, booking hotels, asking for directions, and more. Where would you like to go?",
    welcomeChinese: '你好！我是你的旅行助手。你在计划出行吗？我可以帮你办理登机、订酒店、问路等。你想去哪里？',
  },
  {
    id: 'shopping', label: '🛍️ Shopping', labelCn: '购物',
    welcomeEnglish: "Welcome to our store! How can I help you today? Are you looking for something specific, or would you like to browse around?",
    welcomeChinese: '欢迎光临！今天有什么可以帮您的？您在找特定的商品，还是随便看看？',
  },
  {
    id: 'hotel', label: '🏨 Hotel', labelCn: '酒店',
    welcomeEnglish: "Good evening! Welcome to our hotel. Do you have a reservation? I can help you check in, or if you need any information about our facilities, just let me know.",
    welcomeChinese: '晚上好！欢迎来到我们的酒店。请问您有预订吗？我可以帮您办理入住，如果您需要了解我们的设施信息，请告诉我。',
  },
];

const DIFFICULTIES = [
  { id: 'beginner', label: '🟢 Beginner', labelCn: '初级' },
  { id: 'intermediate', label: '🟡 Intermediate', labelCn: '中级' },
  { id: 'advanced', label: '🔴 Advanced', labelCn: '高级' },
];

// 通话模式 VAD 常量
// 录音参数：format=pcm, sampleRate=16000, mono, frameSize=1KB
// 每帧 = 4KB = 2048 个 16-bit 采样 = 128ms
const VAD_SILENCE_FRAMES = 6;       // 连续静音 6 帧 ≈ 768ms 判定句末
const VAD_MIN_SPEECH_FRAMES = 3;    // 最短说话 3 帧 ≈ 384ms，以下忽略
const VAD_MAX_SPEECH_FRAMES = 156;  // 单段上限 156 帧 ≈ 20 秒，防内存溢出

// 计算 16-bit PCM 帧的能量（平方均值，避免 Math.sqrt 开销）
function calcEnergy(arrayBuffer) {
  if (!arrayBuffer || !arrayBuffer.byteLength) return 0;
  const data = new Int16Array(arrayBuffer);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return sum / (data.length || 1);
}

// 拼接多个 ArrayBuffer
function concatArrayBuffers(buffers) {
  if (!buffers || buffers.length === 0) return new ArrayBuffer(0);
  const validBuffers = buffers.filter(b => b && b.byteLength > 0);
  if (validBuffers.length === 0) return new ArrayBuffer(0);
  const totalLength = validBuffers.reduce((acc, b) => acc + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of validBuffers) {
    result.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return result.buffer;
}

// 16-bit PCM 转 WAV（加 44 字节头）
function encodeWAV(pcmBuffer, sampleRate, numChannels) {
  if (!pcmBuffer || !pcmBuffer.byteLength) {
    pcmBuffer = new ArrayBuffer(0);
  }
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(new Uint8Array(pcmBuffer));
  return buffer;
}

// 清理音频文件，只保留最近 N 个，防止存储堆积
// activePaths: 当前对话仍在引用的文件绝对路径，这些文件不能删
function cleanupAudioFiles(keepCount = 20, activePaths = []) {
  try {
    const fs = wx.getFileSystemManager();
    const files = fs.readdirSync(wx.env.USER_DATA_PATH);
    const protectedNames = new Set(
      (activePaths || []).map(p => String(p).split('/').pop())
    );
    const audioFiles = files
      .filter(f => f.startsWith('call_') || f.startsWith('voice_'))
      .filter(f => !protectedNames.has(f))
      .sort((a, b) => (a < b ? 1 : -1)); // 新的排前（时间戳命名）
    const toDelete = audioFiles.slice(keepCount);
    for (const f of toDelete) {
      fs.unlink(`${wx.env.USER_DATA_PATH}/${f}`, () => {});
    }
  } catch (e) {}
}

Page({
  data: {
    statusBarHeight: 44,
    characterState: CHARACTER_STATES.IDLE,
    isLoading: false,
    isSpeaking: false,
    isRecording: false,
    userTranscript: '',
    error: '',
    playBarHeights: [8, 12, 8, 16, 10, 8, 12, 8, 16, 10],
    recordBarHeights: [8, 12, 8, 16, 10, 8, 12, 8, 16, 10],
    // 场景和难度
    scenarios: SCENARIOS,
    difficulties: DIFFICULTIES,
    scenarioNames: SCENARIOS.map(s => s.label),
    difficultyNames: DIFFICULTIES.map(d => d.label),
    currentScenarioIndex: 0,
    currentDifficultyIndex: 1,
    // 单词点击
    wordTokens: [],
    showWordPopup: false,
    wordInfo: null,
    wordLoading: false,
    // 对话历史（每个场景独立）
    displayTurns: [], // 当前场景的完整对话
    scenarioHistory: {}, // 所有场景的对话记录
    showWelcome: true, // 是否显示欢迎语
    activeUserVoiceIndex: -1, // 正在播放的用户语音索引
    scrollTarget: 'conversation-bottom', // 自动滚动目标
    // 通话模式
    conversationMode: 'press', // 'press'(对讲) | 'call'(畅聊)
    isCallActive: false,      // 通话是否进行中
    callStatus: 'idle',       // idle|listening|processing
    // 氛围光背景
    ambientStyle: 'background: radial-gradient(ellipse at 50% 30%, rgba(0,122,255,0.35), transparent 75%);',
    // 用户画像（长期记忆）
    userProfile: {
      interests: [],
      level: '',
      summary: '',
    },
  },

  audioContext: null,
  recorderManager: null,
  playTimer: null,
  recordTimer: null,
  // 通话模式状态
  _callModeActive: false,
  _callListening: false,
  _callSpeechFrames: [],
  _callPendingFrames: null,  // onStop 专用：VAD 保存帧，onStop 消费，其他地方不清空
  _callSilenceCount: 0,
  _callApiTimer: null,       // API 超时定时器（畅聊模式防卡死）
  _lastSpeechTime: 0,        // 上次检测到说话的时间戳
  _vadHeartbeat: null,       // VAD 心跳定时器（兜底防卡死）

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44,
    });

    this.audioContext = wx.createInnerAudioContext();
    this.recorderManager = wx.getRecorderManager();

    this.audioContext.onEnded(() => {
      // 先无条件复位播放状态，防止 _isUserVoicePlay 提前 return 导致 isSpeaking 卡死
      this.setData({ isSpeaking: false });
      this.stopPlayAnimation();

      if (this._isUserVoicePlay) {
        this._isUserVoicePlay = false;
        this.setData({ activeUserVoiceIndex: -1 });
        return;
      }

      this.setData({ characterState: CHARACTER_STATES.HAPPY }, () => this._syncAmbient());
      setTimeout(() => {
        this.setData({ characterState: CHARACTER_STATES.IDLE }, () => this._syncAmbient());
      }, 2000);

      // 通话模式：AI 播完后继续监听
      if (this.data.isCallActive) {
        this.resumeCallListen();
      }
    });

    this.audioContext.onError(() => {
      this.setData({ isSpeaking: false });
      this.stopPlayAnimation();
      // 畅聊模式：播放失败也要恢复监听，避免卡死
      if (this.data.isCallActive) {
        this.resumeCallListen();
      }
    });

    // 录音完成回调
    this.recorderManager.onStop((res) => {
      this.setData({ isRecording: false });
      this.stopRecordAnimation();

      // 切换模式/挂断/页面销毁触发的强制停止：丢弃本次录音，不做任何处理
      if (this._switchingMode) {
        this._switchingMode = false;
        return;
      }

      // 通话模式：处理说话段
      if (this.data.isCallActive) {
        // 清除心跳定时器
        if (this._vadHeartbeat) {
          clearInterval(this._vadHeartbeat);
          this._vadHeartbeat = null;
        }
        const pending = this._callPendingFrames;
        console.log('[VAD] onStop (call mode), _callPendingFrames:', pending ? pending.length : 'null');
        const frames = pending || [];
        this._callPendingFrames = null;
        this.processCallUtterance(frames);
        return;
      }

      // 按说模式
      this.handleVoiceInput(res.tempFilePath);
    });

    this.recorderManager.onError(() => {
      this.setData({
        isRecording: false,
        error: '录音失败，请检查麦克风权限',
        characterState: CHARACTER_STATES.IDLE,
      }, () => this._syncAmbient());
      this.stopRecordAnimation();
    });

    // VAD 帧回调（畅聊模式用）：onLoad 注册一次，避免 startCall 重复注册
    // 是否处理由 handleCallFrame 内的 isCallActive / _callListening 控制
    this.recorderManager.onFrameRecorded((res) => {
      this.handleCallFrame(res);
    });

    // 恢复保存的对话历史
    const saved = wx.getStorageSync('scenarioHistory');
    if (saved) {
      this.setData({ scenarioHistory: saved });
    }

    // 恢复用户画像
    const savedProfile = wx.getStorageSync('userProfile');
    if (savedProfile) {
      this.setData({ userProfile: savedProfile });
    }

    // 恢复当前场景的对话
    this.loadScenarioConversation(0);
    this._syncAmbient();
  },

  onUnload() {
    this._resetAllAudioState();
    if (this.audioContext) {
      this.audioContext.destroy();
    }
  },

  // ═══════════════════════════════════════
  // 场景 / 难度选择
  // ═══════════════════════════════════════

  // 加载指定场景的对话
  loadScenarioConversation(index) {
    const scenario = SCENARIOS[index];
    let history = this.data.scenarioHistory[scenario.id] || [];

    // 为没有解析过的历史补充单词 token
    history = history.map((turn) => {
      if (!turn.tokens) {
        return { ...turn, tokens: this.parseWords(turn.ai.english) };
      }
      return turn;
    });

    this.setData({
      displayTurns: history,
      showWelcome: history.length === 0,
    });
    this._scrollToBottom();

    if (history.length > 0) {
      const last = history[history.length - 1];
      this.updateWordTokens(last.ai.english);
    } else {
      this.updateWordTokens(scenario.welcomeEnglish);
    }

    // 更新存储内的历史
    const newHistory = { ...this.data.scenarioHistory, [scenario.id]: history };
    this.setData({ scenarioHistory: newHistory });
    wx.setStorageSync('scenarioHistory', newHistory);
  },

  // 保存对话历史到本地存储
  saveScenarioHistory() {
    wx.setStorageSync('scenarioHistory', this.data.scenarioHistory);
  },

  onScenarioChange(e) {
    this.applyScenario(Number(e.detail.value));
  },

  onDifficultyChange(e) {
    this.setData({ currentDifficultyIndex: Number(e.detail.value) });
  },

  // ═══════════════════════════════════════
  // 聊天中自动检测场景切换
  // ═══════════════════════════════════════

  // 从文本中检测场景切换意图，返回匹配的场景 index 或 null
  detectScenarioFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const SCENARIO_KEYWORDS = [
      { index: 1, keywords: ['restaurant', 'order', 'menu', 'waiter', 'food', 'eat', 'dinner', 'lunch', 'breakfast', 'cafe'] },
      { index: 2, keywords: ['interview', 'job', 'hire', 'position', 'resume', 'career', 'work', 'hiring'] },
      { index: 3, keywords: ['travel', 'trip', 'airport', 'flight', 'passport', 'tour', 'vacation', 'plane', 'tourist'] },
      { index: 4, keywords: ['shopping', 'shop', 'store', 'buy', 'purchase', 'mall', 'price', 'customer'] },
      { index: 5, keywords: ['hotel', 'check-in', 'check in', 'reservation', 'room', 'book', 'stay', 'lodge', 'accommodation'] },
    ];
    for (const entry of SCENARIO_KEYWORDS) {
      for (const kw of entry.keywords) {
        if (lower.includes(kw)) return entry.index;
      }
    }
    return null;
  },

  // 从文本中检测难度调整意图，返回匹配的难度 index 或 null
  detectDifficultyFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    // 变简单 → 初级(0)
    const EASY_TRIGGERS = ['too hard', 'too difficult', 'simpler', 'easier', 'this is hard', 'very difficult', 'simple'];
    for (const kw of EASY_TRIGGERS) {
      if (lower.includes(kw)) return 0;
    }
    // 变难 → 高级(2)
    const HARD_TRIGGERS = ['too easy', 'harder', 'more challenging', 'more difficult', 'challenge me', 'advanced', 'difficult'];
    for (const kw of HARD_TRIGGERS) {
      if (lower.includes(kw)) return 2;
    }
    return null;
  },

  // 应用场景选择（共用在弹窗和原生 picker 中）
  applyScenario(index) {
    if (this.audioContext) {
      this.audioContext.stop();
    }
    this.stopPlayAnimation();
    this.setData({
      currentScenarioIndex: index,
      isLoading: false,
      isSpeaking: false,
      characterState: CHARACTER_STATES.IDLE,
    }, () => this._syncAmbient());

    this.loadScenarioConversation(index);

    // 朗读欢迎语或最后一条回复
    const scenario = SCENARIOS[index];
    const history = this.data.scenarioHistory[scenario.id] || [];
    if (history.length === 0) {
      this.playTTS(scenario.welcomeEnglish);
    } else {
      this.playTTS(history[history.length - 1].ai.english);
    }
  },

  // ═══════════════════════════════════════
  // 通话模式
  // ═══════════════════════════════════════

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.conversationMode) return;

    // 彻底清理所有录音/播放状态，防止模式间串扰
    this._resetAllAudioState();

    this.setData({
      conversationMode: mode,
      isCallActive: false,
      isRecording: false,
      callStatus: 'idle',
      isLoading: false,
      isSpeaking: false,
      error: '',
    }, () => this._syncAmbient());
  },

  // 彻底清理所有音频/畅聊状态，用于模式切换
  _resetAllAudioState() {
    // 标记本次 stop 由状态重置触发（切换模式/挂断/页面销毁），onStop 应跳过处理
    // 新一轮录音开始（startRecording/startCallRecording）或 onStop 消费后会清除
    this._switchingMode = true;
    // 停止录音
    try { this.recorderManager.stop(); } catch (e) {}
    // 停止播放
    if (this.audioContext) { this.audioContext.stop(); }
    this.stopPlayAnimation();
    this.stopRecordAnimation();

    // 清理畅聊模式的所有状态
    this._callModeActive = false;
    this._callListening = false;
    this._callSpeechFrames = [];
    this._callPendingFrames = null;
    this._callSilenceCount = 0;
    this._lastSpeechTime = 0;
    if (this._vadHeartbeat) { clearInterval(this._vadHeartbeat); this._vadHeartbeat = null; }
    if (this._callApiTimer) { clearTimeout(this._callApiTimer); this._callApiTimer = null; }
  },

  startCall() {
    // 清理旧音频文件，防止存储堆积（跳过当前对话引用的文件）
    cleanupAudioFiles(20, this.collectActiveAudioPaths(this.data.displayTurns));

    this.setData({
      isCallActive: true,
      callStatus: 'listening',
      error: '',
      characterState: CHARACTER_STATES.LISTENING,
    }, () => this._syncAmbient());
    this._callModeActive = true;
    this._callListening = true;
    this._callSpeechFrames = [];
    this._callPendingFrames = null;
    this._callSilenceCount = 0;
    this._noiseFloor = Infinity; // 自适应 VAD 噪音底噪，Infinity 表示未校准
    this._noiseCalibFrames = 0; // 校准帧计数
    this.startCallRecording();
  },

  startCallRecording() {
    // 若 isRecording 是残留的 true（上一段录音未正常结束），强制停止复位，避免静默卡死
    if (this.data.isRecording) {
      try { this.recorderManager.stop(); } catch (e) {}
      this.setData({ isRecording: false });
    }
    this._switchingMode = false; // 新一轮录音开始，清除切换标志
    this._lastSpeechTime = Date.now();
    this._vadRestartCount = 0; // 录音重启计数（防心跳无限重试导致死循环）
    this.setData({ isRecording: true }); // 标记录音中，防止重复 start() 中断当前录音
    // 心跳兜底：每 500ms 检查一次
    if (this._vadHeartbeat) clearInterval(this._vadHeartbeat);
    this._vadHeartbeat = setInterval(() => {
      if (!this.data.isCallActive) return;
      if (!this._callListening) return;

      const silenceMs = Date.now() - this._lastSpeechTime;
      const frameCount = this._callSpeechFrames.length;

      // 有帧且 2 秒无新语音 → 强制停止
      if (frameCount > 0 && silenceMs > 2000) {
        console.log('[VAD] heartbeat: stop after', silenceMs + 'ms silence, frames:', frameCount);
        this._vadRestartCount = 0;
        this._callListening = false;
        this._callPendingFrames = [...this._callSpeechFrames];
        this._callSpeechFrames = [];
        this.recorderManager.stop();
        return;
      }

      // 没帧且 5 秒无任何帧 → 说明 onFrameRecorded 停了，重启录音（有限次，防死循环）
      if (frameCount === 0 && silenceMs > 5000) {
        this._vadRestartCount++;
        if (this._vadRestartCount >= 3) {
          console.error('[VAD] heartbeat: recording failed to start, ending call');
          this._resetAllAudioState();
          this.setData({
            isCallActive: false,
            callStatus: 'idle',
            isRecording: false,
            isLoading: false,
            isSpeaking: false,
            characterState: CHARACTER_STATES.IDLE,
            error: '录音启动失败，请重新开始对话',
          }, () => this._syncAmbient());
          return;
        }
        console.log('[VAD] heartbeat: no frames for 5s, resetting recording');
        this._callListening = false;
        this.recorderManager.stop();
      }
    }, 500);
    try {
      this.recorderManager.start({
        format: 'pcm',
        sampleRate: 16000,
        numberOfChannels: 1,
        frameSize: 4,
      });
    } catch (e) {
      console.error('startCallRecording error:', e);
      this.setData({ error: '通话录音启动失败' });
    }
  },

  endCall() {
    this._resetAllAudioState();
    this.setData({
      isCallActive: false,
      callStatus: 'idle',
      isRecording: false,
      isLoading: false,
      isSpeaking: false,
      characterState: CHARACTER_STATES.IDLE,
    }, () => this._syncAmbient());
  },

  resumeCallListen() {
    if (!this.data.isCallActive) return;
    // 已经在监听中，无需重复启动（防止 onEnded 延迟触发导致的录音重启）
    if (this._callListening) {
      console.log('[VAD] resumeCallListen skipped: already listening');
      return;
    }
    console.log('[VAD] resumeCallListen');
    this._callListening = true;
    this._callSpeechFrames = [];
    this._callSilenceCount = 0;
    this.setData({ callStatus: 'listening', characterState: CHARACTER_STATES.LISTENING }, () => this._syncAmbient());
    this.startCallRecording();
  },

  // VAD 逐帧处理（半双工：录音只在上一次 AI 播完后运行）
  handleCallFrame(res) {
    try {
      if (!this.data.isCallActive || !this._callListening) return;
      if (!res || !res.frameBuffer) return;

      const energy = calcEnergy(res.frameBuffer);

      // 自适应噪声底噪：前 10 帧取最小值作为底噪（防止第一帧碰巧是人声导致阈值过高）
      if (this._noiseCalibFrames < 10) {
        this._noiseFloor = Math.min(this._noiseFloor, energy);
        this._noiseCalibFrames++;
        if (this._noiseCalibFrames === 10) {
          console.log('[VAD] noise floor calibrated:', Math.round(this._noiseFloor));
        }
      } else if (energy < this._noiseFloor * 2.5) {
        // 非说话帧 → 更新噪音底噪
        this._noiseFloor = this._noiseFloor * 0.95 + energy * 0.05;
      }
      const isSpeech = energy > this._noiseFloor * 2.5;

      // 调试：每 10 帧输出能量和噪音底噪
      if (this._callSpeechFrames.length % 10 === 0) {
        console.log('[VAD] energy:', Math.round(energy), 'noiseFloor:', Math.round(this._noiseFloor), 'isSpeech:', isSpeech, 'frames:', this._callSpeechFrames.length);
      }

      if (isSpeech) {
        this._vadRestartCount = 0; // 有说话帧，说明录音正常，重置重启计数
        this._lastSpeechTime = Date.now(); // 更新语音活动时间戳（心跳兜底用）
        if (this._callSpeechFrames.length === 0) {
          this._recordStartTime = Date.now(); // 记录说话开始时间
        }
        this._callSpeechFrames.push(res.frameBuffer);
        this._callSilenceCount = 0;

        // 防止单段语音无限累积（超时强制处理）
        if (this._callSpeechFrames.length >= VAD_MAX_SPEECH_FRAMES) {
          this._callListening = false;
          this._callPendingFrames = [...this._callSpeechFrames];
          this._callSpeechFrames = [];
          this.recorderManager.stop();
        }
      } else if (this._callSpeechFrames.length > 0) {
        this._callSilenceCount++;
        if (this._callSilenceCount >= VAD_SILENCE_FRAMES) {
          // 该轮说话结束——停止录音，触发 onStop 处理
          this._callListening = false;
          this._callPendingFrames = [...this._callSpeechFrames];
          this._callSpeechFrames = [];
          console.log('[VAD] stop, pending frames:', this._callPendingFrames.length);
          this.recorderManager.stop();
        }
      }
    } catch (e) {
      console.error('VAD error:', e);
    }
  },

  // 处理一回合说话内容
  processCallUtterance(frames) {
    try {
      console.log('[VAD] processCallUtterance frames:', frames.length);
      if (!frames || frames.length < VAD_MIN_SPEECH_FRAMES) {
        // 太短，忽略，继续监听
        this.setData({ callStatus: 'listening', characterState: CHARACTER_STATES.LISTENING }, () => this._syncAmbient());
        this.resumeCallListen();
        return;
      }

      this.setData({ callStatus: 'processing' });

      // PCM 转 WAV 后写入临时文件
      const pcmData = concatArrayBuffers(frames);
      const wavBuffer = encodeWAV(pcmData, 16000, 1);
      const tempPath = `${wx.env.USER_DATA_PATH}/call_${Date.now()}.wav`;
      const fs = wx.getFileSystemManager();
      fs.writeFile({
        filePath: tempPath,
        data: wavBuffer,
        success: () => {
          this.handleVoiceInput(tempPath);
        },
        fail: () => {
          this.setData({ error: '通话录音处理失败' });
          this.resumeCallListen();
        },
      });
    } catch (e) {
      console.error('processCallUtterance error:', e);
      this.setData({ error: '通话处理异常' });
      this.resumeCallListen();
    }
  },

  // ═══════════════════════════════════════
  // 语音输入
  // ═══════════════════════════════════════

  onToggleRecord() {
    if (this.data.isRecording) {
      this.recorderManager.stop();
    } else {
      this.startRecording();
    }
  },

  startRecording() {
    // 强制停止可能残留的录音，确保 recorder 处于干净状态（畅聊卡死后切换回对讲时必走此路）
    try { this.recorderManager.stop(); } catch (e) {}
    this._switchingMode = false; // 新一轮录音开始，清除切换标志
    this._recordStartTime = Date.now(); // 记录开始时间
    this.setData({
      isRecording: true,
      error: '',
      characterState: CHARACTER_STATES.LISTENING,
    }, () => this._syncAmbient());
    this.startRecordAnimation();

    try {
      this.recorderManager.start({
        format: 'mp3',
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 24000,
      });
    } catch (e) {
      console.error('startRecording error:', e);
      this.setData({ isRecording: false, error: '录音启动失败' });
      this.stopRecordAnimation();
    }
  },

  // 处理语音输入 → 语音输出
  async handleVoiceInput(tempFilePath) {
    const scenarioId = this.data.scenarios[this.data.currentScenarioIndex].id;
    const modeAtRequest = this.data.conversationMode; // 记录请求发起时的模式

    // 计算用户录音时长
    const userDuration = this._recordStartTime
      ? Math.round((Date.now() - this._recordStartTime) / 1000)
      : 3;
    const userDurText = this.formatDuration(userDuration);

    // 立即创建用户语音气泡（不等 API）
    const pendingTurn = {
      user: '🎤',
      ai: { english: '', chinese: '', correction: null },
      tokens: [],
      isVoice: true,
      isPending: true,
      aiAudioPath: null,
      userAudioPath: tempFilePath,
      userDuration,
      userDurationText: userDurText,
      aiDuration: 0,
      aiDurationText: '',
      isPlaying: false,
    };
    const history = this.data.scenarioHistory[scenarioId] || [];
    const updatedHistory = [...history, pendingTurn];
    const newHistory = { ...this.data.scenarioHistory, [scenarioId]: updatedHistory };

    this.setData({
      scenarioHistory: newHistory,
      displayTurns: updatedHistory,
      showWelcome: false,
      isLoading: true,
      characterState: CHARACTER_STATES.THINKING,
      callStatus: this.data.isCallActive ? 'processing' : this.data.callStatus,
    }, () => {
      this._syncAmbient();
      this._scrollToBottom();
    });

    try {
      // 构建 AI 历史（滑动窗口：只发最近 20 轮，控制上下文窗口）
      const recentHistory = history.slice(-20);
      const aiHistory = [];
      // 注入用户画像（长期记忆）作为 system 消息，让 AI 了解用户背景
      if (this.data.userProfile.summary) {
        aiHistory.push({
          role: 'system',
          content: `User profile: ${this.data.userProfile.summary} Tailor your responses to the user's interests and level.`,
        });
      }
      for (const turn of recentHistory) {
        if (turn.user && turn.user !== '🎤') {
          aiHistory.push({ role: 'user', content: turn.user });
        }
        if (turn.ai && turn.ai.english) {
          aiHistory.push({ role: 'assistant', content: turn.ai.english });
        }
      }

      const result = await Promise.race([
        API.sendVoiceForChat(
          tempFilePath, scenarioId,
          this.data.difficulties[this.data.currentDifficultyIndex].id,
          aiHistory,
          this.data.userProfile.summary || ''
        ),
        // 30 秒超时，防止畅聊模式卡在 processing
        new Promise((_, reject) => {
          this._callApiTimer = setTimeout(() => {
            reject(new Error('API timeout'));
          }, 30000);
        }),
      ]);
      clearTimeout(this._callApiTimer);
      // 等待 AI 期间用户切换了模式：丢弃本次结果，并移除 pending 回合
      if (modeAtRequest !== this.data.conversationMode) {
        const staleHistory = this.data.scenarioHistory[scenarioId].slice(0, -1);
        this.setData({
          scenarioHistory: { ...this.data.scenarioHistory, [scenarioId]: staleHistory },
          displayTurns: staleHistory,
          isLoading: false,
          characterState: CHARACTER_STATES.IDLE,
        }, () => this._syncAmbient());
        return;
      }
      if (!result.audioPath) throw new Error('No audio response');

      // 更新用户画像（长期记忆）
      this._updateUserProfile(result.userText || '', result.aiCorrection);

      // 聊天中自动检测场景/难度切换（静默更新，下次调用生效）
      const userText = result.userText || '';
      const detectedScenario = this.detectScenarioFromText(userText);
      const detectedDifficulty = this.detectDifficultyFromText(userText);
      if (detectedScenario !== null && detectedScenario !== this.data.currentScenarioIndex) {
        this.setData({ currentScenarioIndex: detectedScenario });
      }
      if (detectedDifficulty !== null && detectedDifficulty !== this.data.currentDifficultyIndex) {
        this.setData({ currentDifficultyIndex: detectedDifficulty });
      }

      // 替换 pending 为完整记录
      const turn = {
        user: result.userText || '🎤',
        ai: {
          english: result.aiEnglish, chinese: result.aiChinese,
          correction: result.aiCorrection || null,
        },
        tokens: this.parseWords(result.aiEnglish),
        isVoice: true, isPending: false,
        aiAudioPath: result.audioPath,
        userAudioPath: tempFilePath,
        userDuration,
        userDurationText: userDurText,
        aiDuration: 0,
        aiDurationText: '',
        isPlaying: false,
      };
      const finalHistory = [...this.data.scenarioHistory[scenarioId].slice(0, -1), turn];
      this.setData({
        scenarioHistory: { ...this.data.scenarioHistory, [scenarioId]: finalHistory },
        displayTurns: finalHistory, isLoading: false,
        characterState: CHARACTER_STATES.SPEAKING,
        callStatus: this.data.isCallActive ? 'speaking' : this.data.callStatus,
      }, () => {
        this._syncAmbient();
        this._scrollToBottom();
      });
      this.saveScenarioHistory();

      // 播放 AI 语音回复，并通过 onCanplay 获取时长
      this.setData({ isSpeaking: true });
      this.startPlayAnimation();
      // AI 语音接管音频上下文，清除上一段用户语音播放状态，防止标志泄漏
      this._isUserVoicePlay = false;
      this.setData({ activeUserVoiceIndex: -1 });
      this.audioContext.src = result.audioPath;
      this._currentTurnIndex = finalHistory.length - 1;
      this.audioContext.play();

      // 本轮结束，清理旧音频文件（跳过当前对话引用的文件）
      cleanupAudioFiles(20, this.collectActiveAudioPaths(this.data.displayTurns));

      // 监听音频就绪，获取时长
      const getDuration = () => {
        const dur = this.audioContext.duration;
        if (dur && dur > 0) {
          const duration = Math.round(dur);
          this.updateTurnDuration(this._currentTurnIndex, duration);
          this.audioContext.offCanplay(getDuration);
        }
      };
      this.audioContext.onCanplay(getDuration);
      setTimeout(getDuration, 500); // 兜底
    } catch (err) {
      console.error('Voice input error:', err);
      const errHistory = this.data.scenarioHistory[scenarioId].slice(0, -1);
      this.setData({
        scenarioHistory: { ...this.data.scenarioHistory, [scenarioId]: errHistory },
        displayTurns: errHistory, isLoading: false,
        characterState: CHARACTER_STATES.IDLE, error: '语音处理失败，请重试',
        callStatus: this.data.isCallActive ? 'listening' : this.data.callStatus,
      }, () => this._syncAmbient());
      if (this.data.isCallActive) this.resumeCallListen();
    }
  },

  // 更新某条记录的语音时长
  updateTurnDuration(index, duration) {
    const turns = this.data.displayTurns;
    if (!turns[index]) return;
    turns[index].aiDuration = duration;
    turns[index].aiDurationText = this.formatDuration(duration);
    this.setData({ displayTurns: turns });
  },

  // 收集当前对话仍在引用的音频文件路径（防止被清理删除）
  collectActiveAudioPaths(turns) {
    const paths = [];
    for (const turn of turns || []) {
      if (turn.aiAudioPath) paths.push(turn.aiAudioPath);
      if (turn.userAudioPath) paths.push(turn.userAudioPath);
    }
    return paths;
  },

  // 格式化秒数为 mm:ss
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:03';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  async callChatAPI(text) {
    // 聊天中自动检测场景/难度切换
    const detectedScenario = this.detectScenarioFromText(text);
    const detectedDifficulty = this.detectDifficultyFromText(text);
    if (detectedScenario !== null && detectedScenario !== this.data.currentScenarioIndex) {
      this.setData({ currentScenarioIndex: detectedScenario });
    }
    if (detectedDifficulty !== null && detectedDifficulty !== this.data.currentDifficultyIndex) {
      this.setData({ currentDifficultyIndex: detectedDifficulty });
    }

    const scenarioId = this.data.scenarios[this.data.currentScenarioIndex].id;
    const history = this.data.scenarioHistory[scenarioId] || [];

    // 构建 AI 历史（滑动窗口：只发最近 20 轮，控制上下文窗口）
    const recentHistory = history.slice(-20);
    const aiHistory = [];
    // 注入用户画像（长期记忆）作为 system 消息，让 AI 了解用户背景
    if (this.data.userProfile.summary) {
      aiHistory.push({
        role: 'system',
        content: `User profile: ${this.data.userProfile.summary} Tailor your responses to the user's interests and level.`,
      });
    }
    for (const turn of recentHistory) {
      aiHistory.push({ role: 'user', content: turn.user });
      aiHistory.push({ role: 'assistant', content: turn.ai.english });
    }

    try {
      const result = await API.sendChat(
        text,
        scenarioId,
        this.data.difficulties[this.data.currentDifficultyIndex].id,
        aiHistory,
        this.data.userProfile.summary || ''
      );

      // 更新用户画像（长期记忆）
      this._updateUserProfile(text, result.correction);

      const turn = {
        user: text,
        ai: {
          english: result.english,
          chinese: result.chinese,
          correction: result.correction || null,
        },
        tokens: this.parseWords(result.english),
      };

      // 保存到场景历史
      const updatedHistory = [...history, turn];
      const newHistory = { ...this.data.scenarioHistory, [scenarioId]: updatedHistory };

      this.setData({
        scenarioHistory: newHistory,
        displayTurns: updatedHistory,
        showWelcome: false,
        isLoading: false,
        characterState: result.correction
          ? CHARACTER_STATES.CORRECTING
          : CHARACTER_STATES.HAPPY,
      }, () => {
        this._syncAmbient();
        this._scrollToBottom();
      });
      this.updateWordTokens(turn.ai.english);
      this.saveScenarioHistory();

      // TTS
      this.playTTS(turn.ai.english);
    } catch (err) {
      console.error('Chat error:', err);
      this.setData({
        isLoading: false,
        characterState: CHARACTER_STATES.IDLE,
        error: 'Network error. Please try again.',
      }, () => this._syncAmbient());
    }
  },

  // ═══════════════════════════════════════
  // TTS 语音朗读
  // ═══════════════════════════════════════

  playTTS(text) {
    this.setData({ isSpeaking: true, characterState: CHARACTER_STATES.SPEAKING }, () => this._syncAmbient());
    this.startPlayAnimation();

    API.getTTSAudio(text)
      .then((audioPath) => {
        this.audioContext.src = audioPath;
        this.audioContext.play();
      })
      .catch((err) => {
        console.error('TTS error:', err);
        this.setData({
          isSpeaking: false,
          characterState: CHARACTER_STATES.HAPPY,
        }, () => this._syncAmbient());
        this.stopPlayAnimation();
        setTimeout(() => {
          this.setData({ characterState: CHARACTER_STATES.IDLE }, () => this._syncAmbient());
        }, 2000);
      });
  },

  // ═══════════════════════════════════════
  // 单词点击查询
  // ═══════════════════════════════════════

  parseWords(text) {
    if (!text) return [];
    const tokens = [];
    const parts = text.split(/(\s+|[,.!?;:'"()\[\]{}])/);
    for (const part of parts) {
      if (!part) continue;
      const isWord = /^[a-zA-Z]+(?:'[a-zA-Z]+)?$/.test(part);
      tokens.push({ text: part, isWord });
    }
    return tokens;
  },

  updateWordTokens(text) {
    this.setData({ wordTokens: this.parseWords(text) });
  },

  onWordTap(e) {
    const word = e.currentTarget.dataset.word;
    if (!word) return;

    this.setData({
      showWordPopup: true,
      wordLoading: true,
      wordInfo: null,
    });

    API.lookupWord(word)
      .then((info) => {
        this.setData({ wordInfo: info, wordLoading: false });
      })
      .catch(() => {
        this.setData({
          wordInfo: null,
          wordLoading: false,
          wordInfo: { word, phonetic: '', chinese: '', meanings: [{ partOfSpeech: '', definition: 'Lookup failed', example: '' }] },
        });
      });
  },

  onCloseWordPopup() {
    this.setData({ showWordPopup: false, wordInfo: null });
  },

  playWordSound() {
    const word = this.data.wordInfo && this.data.wordInfo.word;
    if (word) {
      this.playTTS(word);
    }
  },

  noop() {},

  // 滚动到对话底部
  _scrollToBottom() {
    this.setData({ scrollTarget: '' });
    setTimeout(() => {
      this.setData({ scrollTarget: 'conversation-bottom' });
    }, 50);
  },

  // 同步氛围光背景
  _syncAmbient() {
    const state = this.data.characterState;
    const color = AMBIENT_COLORS[state] || AMBIENT_COLORS.idle;
    this.setData({
      ambientStyle: `background: radial-gradient(ellipse at 50% 30%, ${color}, transparent 75%);`,
    });
  },

  // ═══════════════════════════════════════
  // 用户画像（长期记忆）
  // ═══════════════════════════════════════

  // 更新用户画像：根据对话内容记录兴趣等
  _updateUserProfile(userText, correction) {
    if (!userText) return;
    const profile = { ...this.data.userProfile };

    // 检测兴趣（复用场景关键词）
    const detectedScenario = this.detectScenarioFromText(userText);
    if (detectedScenario !== null) {
      const label = this.data.scenarios[detectedScenario].label;
      if (!profile.interests.includes(label)) {
        profile.interests.push(label);
      }
    }

    // 记录需要纠错（说明该领域有待提高）
    if (correction) {
      profile.mistakes = profile.mistakes || [];
      // 简单记录，避免重复
      if (profile.mistakes.length === 0 || profile.mistakes[profile.mistakes.length - 1] !== 'recent') {
        profile.mistakes.push('recent');
      }
    }

    // 更新难度
    profile.level = this.data.difficulties[this.data.currentDifficultyIndex].id;

    // 生成摘要文本（发给 AI 的长期记忆）
    profile.summary = this._buildProfileSummary(profile);

    this.setData({ userProfile: profile });
    wx.setStorageSync('userProfile', profile);
  },

  // 生成用户画像摘要（压缩成一段话，随每次请求发给 AI）
  _buildProfileSummary(profile) {
    const parts = [];
    if (profile.interests && profile.interests.length > 0) {
      parts.push(`User is interested in: ${profile.interests.join(', ')}.`);
    }
    if (profile.level) {
      parts.push(`Current difficulty: ${profile.level}.`);
    }
    if (profile.mistakes && profile.mistakes.length > 0) {
      parts.push('User has received corrections recently, may need guidance on accuracy.');
    }
    return parts.join(' ');
  },

  // 播放历史语音消息
  playVoiceMessage(e) {
    const index = e.currentTarget.dataset.turnIndex;
    const turn = this.data.displayTurns[index];
    if (turn && turn.aiAudioPath) {
      // 重播 AI 语音，清除上一段用户语音播放状态，防止标志泄漏
      this._isUserVoicePlay = false;
      this.setData({ activeUserVoiceIndex: -1 });
      this.audioContext.src = turn.aiAudioPath;
      this.audioContext.play();
    }
  },

  // 点击播放用户语音
  onPlayUserVoice(e) {
    const index = e.currentTarget.dataset.turnIndex;
    const turn = this.data.displayTurns[index];
    if (!turn || !turn.userAudioPath) return;

    // 如果正在播放同一个，停止
    if (this.data.activeUserVoiceIndex === index) {
      this.audioContext.stop();
      this._isUserVoicePlay = false;
      this.setData({ activeUserVoiceIndex: -1 });
      return;
    }

    // 停止当前所有播放（可能打断正在播放的 AI 语音）
    this.audioContext.stop();
    // 打断的 AI 语音不会触发 onEnded，需手动复位 isSpeaking，避免录音按钮卡死
    this.setData({ isSpeaking: false });
    this.stopPlayAnimation();
    this._isUserVoicePlay = true;
    this.audioContext.src = turn.userAudioPath;
    this.audioContext.play();
    this.setData({ activeUserVoiceIndex: index });
  },

  // ═══════════════════════════════════════
  // 声波动画
  // ═══════════════════════════════════════

  startPlayAnimation() {
    this.playTimer = setInterval(() => {
      const heights = Array.from({ length: 10 }, () =>
        Math.round(4 + Math.random() * 24)
      );
      this.setData({ playBarHeights: heights });
    }, 150);
  },

  stopPlayAnimation() {
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    this.setData({
      playBarHeights: [8, 12, 8, 16, 10, 8, 12, 8, 16, 10],
    });
  },

  startRecordAnimation() {
    this.recordTimer = setInterval(() => {
      const heights = Array.from({ length: 10 }, () =>
        Math.round(4 + Math.random() * 24)
      );
      this.setData({ recordBarHeights: heights });
    }, 150);
  },

  stopRecordAnimation() {
    if (this.recordTimer) {
      clearInterval(this.recordTimer);
      this.recordTimer = null;
    }
    this.setData({
      recordBarHeights: [8, 12, 8, 16, 10, 8, 12, 8, 16, 10],
    });
  },
});