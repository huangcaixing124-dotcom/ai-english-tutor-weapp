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
  idle: 'rgba(0, 122, 255, 0.25)',
  listening: 'rgba(90, 200, 250, 0.28)',
  thinking: 'rgba(255, 149, 0, 0.28)',
  speaking: 'rgba(52, 199, 89, 0.28)',
  happy: 'rgba(255, 214, 10, 0.28)',
  correcting: 'rgba(175, 82, 222, 0.28)',
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

// ═══════ 通话模式 VAD 常量 ═══════
// 录音参数：format=pcm, sampleRate=16000, mono, frameSize=1KB
// 每帧 = 4KB = 2048 个 16-bit 采样 = 128ms
const VAD_SPEECH_THRESHOLD = 640000;   // 能量阈值（RMS 800 的平方）
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
    conversationMode: 'press', // 'press'(按说) | 'call'(通话)
    isCallActive: false,      // 通话是否进行中
    callStatus: 'idle',       // idle|listening|processing
    // 氛围光背景
    ambientStyle: 'background: radial-gradient(ellipse at 50% 0%, rgba(0,122,255,0.12), transparent 65%);',
  },

  audioContext: null,
  recorderManager: null,
  playTimer: null,
  recordTimer: null,
  // 通话模式状态
  _callModeActive: false,
  _callListening: false,
  _callSpeechFrames: [],
  _callSilenceCount: 0,
  _callModeRecording: false, // 当前录音会话是否为通话模式（PCM）

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44,
    });

    this.audioContext = wx.createInnerAudioContext();
    this.recorderManager = wx.getRecorderManager();

    this.audioContext.onEnded(() => {
      if (this._isUserVoicePlay) {
        this._isUserVoicePlay = false;
        this.setData({ activeUserVoiceIndex: -1 });
        return;
      }

      this.setData({ isSpeaking: false });
      this.stopPlayAnimation();
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
    });

    // 录音完成回调
    this.recorderManager.onStop((res) => {
      this.setData({ isRecording: false });
      this.stopRecordAnimation();

      // 通话模式：处理说话段
      if (this._callModeRecording) {
        this._callModeRecording = false;
        const frames = this._callSpeechFrames;
        this._callSpeechFrames = [];
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

    // 恢复保存的对话历史
    const saved = wx.getStorageSync('scenarioHistory');
    if (saved) {
      this.setData({ scenarioHistory: saved });
    }

    // 恢复当前场景的对话
    this.loadScenarioConversation(0);
    this._syncAmbient();
  },

  onUnload() {
    this.stopPlayAnimation();
    this.stopRecordAnimation();
    if (this.data.isCallActive) {
      this.endCall();
    }
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
    const index = e.detail.value;
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

  onDifficultyChange(e) {
    const index = e.detail.value;
    this.setData({ currentDifficultyIndex: index });
  },

  // ═══════════════════════════════════════
  // 通话模式
  // ═══════════════════════════════════════

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.conversationMode) return;

    // 退出当前模式的活跃状态
    if (this.data.isCallActive) {
      this.endCall();
    }
    if (this.data.isRecording) {
      this.recorderManager.stop();
    }

    this.setData({ conversationMode: mode });
  },

  startCall() {
    // 通话模式开启后注册 VAD 帧回调（不放在 onLoad，避免影响按说模式）
    this.recorderManager.onFrameRecorded((res) => {
      this.handleCallFrame(res);
    });

    // 清理旧音频文件，防止存储堆积
    try {
      const fs = wx.getFileSystemManager();
      const files = fs.readdirSync(wx.env.USER_DATA_PATH);
      for (const f of files) {
        if (f.startsWith('call_') || f.startsWith('voice_')) {
          fs.unlink(`${wx.env.USER_DATA_PATH}/${f}`, () => {});
        }
      }
    } catch (e) {}

    this.setData({
      isCallActive: true,
      callStatus: 'listening',
      error: '',
      characterState: CHARACTER_STATES.LISTENING,
    }, () => this._syncAmbient());
    this._callModeActive = true;
    this._callListening = true;
    this._callSpeechFrames = [];
    this._callSilenceCount = 0;
    this.startCallRecording();
  },

  startCallRecording() {
    this._callModeRecording = true; // 通话模式（PCM）
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
    this._callModeActive = false;
    this._callListening = false;
    this._callSpeechFrames = [];
    this._callSilenceCount = 0;
    if (this.audioContext) {
      this.audioContext.stop();
    }
    this.recorderManager.stop();
    this.setData({
      isCallActive: false,
      callStatus: 'idle',
      isRecording: false,
      isLoading: false,
      isSpeaking: false,
      characterState: CHARACTER_STATES.IDLE,
    }, () => this._syncAmbient());
    this.stopPlayAnimation();
    this.stopRecordAnimation();
  },

  resumeCallListen() {
    if (!this.data.isCallActive) return;
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
      const isSpeech = energy > VAD_SPEECH_THRESHOLD;

      if (isSpeech) {
        if (this._callSpeechFrames.length === 0) {
          this._recordStartTime = Date.now(); // 记录说话开始时间
        }
        this._callSpeechFrames.push(res.frameBuffer);
        this._callSilenceCount = 0;

        // 防止单段语音无限累积（超时强制处理）
        if (this._callSpeechFrames.length >= VAD_MAX_SPEECH_FRAMES) {
          this._callListening = false;
          this.recorderManager.stop();
        }
      } else if (this._callSpeechFrames.length > 0) {
        this._callSilenceCount++;
        if (this._callSilenceCount >= VAD_SILENCE_FRAMES) {
          // 该轮说话结束——停止录音，触发 onStop 处理
          this._callListening = false;
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
    this._callModeRecording = false; // 按说模式（mp3）
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
      // 构建 AI 历史（当前轮之前的对话）
      const aiHistory = [];
      for (const turn of history) {
        if (turn.user && turn.user !== '🎤') {
          aiHistory.push({ role: 'user', content: turn.user });
        }
        if (turn.ai && turn.ai.english) {
          aiHistory.push({ role: 'assistant', content: turn.ai.english });
        }
      }

      const result = await API.sendVoiceForChat(
        tempFilePath, scenarioId,
        this.data.difficulties[this.data.currentDifficultyIndex].id,
        aiHistory
      );
      if (!result.audioPath) throw new Error('No audio response');

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
      this.audioContext.src = result.audioPath;
      this._currentTurnIndex = finalHistory.length - 1;
      this.audioContext.play();

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

  // 格式化秒数为 mm:ss
  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:03';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  async callChatAPI(text) {
    const scenarioId = this.data.scenarios[this.data.currentScenarioIndex].id;
    const history = this.data.scenarioHistory[scenarioId] || [];

    // 构建 AI 历史格式
    const aiHistory = [];
    for (const turn of history) {
      aiHistory.push({ role: 'user', content: turn.user });
      aiHistory.push({ role: 'assistant', content: turn.ai.english });
    }

    try {
      const result = await API.sendChat(
        text,
        scenarioId,
        this.data.difficulties[this.data.currentDifficultyIndex].id,
        aiHistory
      );

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

  // 播放历史语音消息
  playVoiceMessage(e) {
    const index = e.currentTarget.dataset.turnIndex;
    const turn = this.data.displayTurns[index];
    if (turn && turn.aiAudioPath) {
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

    // 停止当前所有播放
    this.audioContext.stop();
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