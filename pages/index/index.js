const API = require('../../utils/api');

const CHARACTER_STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  CORRECTING: 'correcting',
  HAPPY: 'happy',
};

const SCENARIOS = [
  {
    id: 'free', label: '💬 Free Talk', labelCn: '自由对话',
    welcomeEnglish: "Hi there! I'm your AI English tutor. You can type in English or Chinese — I'll understand both and help you practice. What would you like to talk about today?",
    welcomeChinese: '你好！我是你的 AI 英语口语教练。你可以用中文或英文输入，我都能理解。今天想聊什么？',
  },
  {
    id: 'restaurant', label: '🍽️ Restaurant', labelCn: '餐厅',
    welcomeEnglish: "Welcome to our restaurant! I'll be your waiter today. Would you like to see the menu or would you like me to recommend today's specials?",
    welcomeChinese: '欢迎来到我们的餐厅！今天我是你的服务员。你想看看菜单，还是让我推荐今日特色菜？',
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

Page({
  data: {
    statusBarHeight: 44,
    characterState: CHARACTER_STATES.IDLE,
    isLoading: false,
    isSpeaking: false,
    inputText: '',
    userTranscript: '',
    error: '',
    playBarHeights: [8, 12, 8, 16, 10],
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
  },

  audioContext: null,
  playTimer: null,

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight || 44,
    });

    this.audioContext = wx.createInnerAudioContext();

    this.audioContext.onEnded(() => {
      this.setData({ isSpeaking: false });
      this.stopPlayAnimation();
      this.setData({ characterState: CHARACTER_STATES.HAPPY });
      setTimeout(() => {
        this.setData({ characterState: CHARACTER_STATES.IDLE });
      }, 2000);
    });

    this.audioContext.onError(() => {
      this.setData({ isSpeaking: false });
      this.stopPlayAnimation();
    });

    // 恢复保存的对话历史
    const saved = wx.getStorageSync('scenarioHistory');
    if (saved) {
      this.setData({ scenarioHistory: saved });
    }

    // 恢复当前场景的对话
    this.loadScenarioConversation(0);
  },

  onUnload() {
    this.stopPlayAnimation();
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
    });

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
  // 文字输入对话
  // ═══════════════════════════════════════

  onInputChange(e) {
    this.setData({ inputText: e.detail.value });
  },

  onSendText() {
    const text = this.data.inputText.trim();
    if (!text || this.data.isLoading || this.data.isSpeaking) return;

    this.setData({
      inputText: '',
      error: '',
      userTranscript: text,
      currentTurn: null,
      isLoading: true,
      characterState: CHARACTER_STATES.THINKING,
    });

    this.callChatAPI(text);
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
      });
    }
  },

  // ═══════════════════════════════════════
  // TTS 语音朗读
  // ═══════════════════════════════════════

  playTTS(text) {
    this.setData({ isSpeaking: true, characterState: CHARACTER_STATES.SPEAKING });
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
        });
        this.stopPlayAnimation();
        setTimeout(() => {
          this.setData({ characterState: CHARACTER_STATES.IDLE });
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

  // ═══════════════════════════════════════
  // 声波动画
  // ═══════════════════════════════════════

  startPlayAnimation() {
    this.playTimer = setInterval(() => {
      const heights = Array.from({ length: 5 }, () =>
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
      playBarHeights: [8, 12, 8, 16, 10],
    });
  },
});