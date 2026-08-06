App({
  onLaunch() {
    // 使用新版 API 获取系统信息
    const windowInfo = wx.getWindowInfo();
    this.globalData.statusBarHeight = windowInfo.statusBarHeight || 44;
  },

  globalData: {
    statusBarHeight: 44,
  },
});