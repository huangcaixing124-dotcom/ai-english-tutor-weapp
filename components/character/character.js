// 角色状态文字映射
const STATE_TEXT = {
  idle: '',
  listening: 'Listening...',
  thinking: 'Thinking...',
  speaking: 'Speaking...',
  correcting: 'Tip for you',
  happy: 'Great!',
};

Component({
  properties: {
    state: {
      type: String,
      value: 'idle',
      observer: 'onStateChange',
    },
  },

  data: {
    stateText: '',
    isBlinking: false,
  },

  methods: {
    onStateChange(newState) {
      this.setData({
        stateText: STATE_TEXT[newState] || '',
      });

      // 非 idle/listening 状态下停止眨眼
      if (newState !== 'idle' && newState !== 'listening') {
        this.stopBlink();
      } else {
        this.startBlink();
      }
    },

    startBlink() {
      this.stopBlink();
      this._blinkTimer = setInterval(() => {
        this.setData({ isBlinking: true });
        setTimeout(() => {
          this.setData({ isBlinking: false });
        }, 150);
      }, 2500 + Math.random() * 2000);
    },

    stopBlink() {
      if (this._blinkTimer) {
        clearInterval(this._blinkTimer);
        this._blinkTimer = null;
      }
    },
  },

  lifetimes: {
    attached() {
      if (this.data.state === 'idle' || this.data.state === 'listening') {
        this.startBlink();
      }
    },
    detached() {
      this.stopBlink();
    },
  },
});