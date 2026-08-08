App({
  onLaunch() {
    // 全局错误捕获，防止未处理异常导致崩溃
    wx.onError && wx.onError((err) => {
      console.error('[Global Error]', err);
    });
    wx.onUnhandledRejection && wx.onUnhandledRejection((err) => {
      console.error('[Unhandled Rejection]', err);
    });

    // 使用新版 API 获取系统信息
    const windowInfo = wx.getWindowInfo();
    this.globalData.statusBarHeight = windowInfo.statusBarHeight || 44;
  },

  globalData: {
    statusBarHeight: 44,
  },
});