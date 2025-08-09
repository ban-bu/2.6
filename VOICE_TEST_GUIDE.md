# 語音功能測試指南

## 🛠️ 問題修復說明

已修復的問題：
- ✅ 修復了 `socket is not defined` 錯誤
- ✅ 正確引用 `window.realtimeClient.socket` 實例
- ✅ 修復了全局變數引用問題 (`currentRoomId` → `roomId`)
- ✅ 添加了連接狀態檢查和錯誤處理
- ✅ 實現了重連時自動恢復事件監聽器

## 🧪 測試步驟

### 1. 基本功能測試

1. **打開網頁**
   - 在瀏覽器中打開 `index.html`
   - 確保看到語音通話按鈕

2. **檢查初始化**
   - 按 F12 打開開發者工具
   - 在控制台中運行以下命令檢查初始化狀態：
   ```javascript
   console.log('語音功能檢查:');
   console.log('realtimeClient:', window.realtimeClient ? '✓ 已加載' : '✗ 未加載');
   console.log('socket:', window.realtimeClient?.socket ? '✓ 已連接' : '✗ 未連接');
   console.log('voiceCallManager:', typeof voiceCallManager !== 'undefined' ? '✓ 已初始化' : '✗ 未初始化');
   console.log('voiceTranscriptionManager:', typeof voiceTranscriptionManager !== 'undefined' ? '✓ 已初始化' : '✗ 未初始化');
   ```

3. **測試權限請求**
   - 點擊"語音通話"按鈕
   - 應該彈出麥克風權限請求
   - 點擊"允許"

### 2. 連接狀態測試

在控制台運行以下代碼檢查連接狀態：
```javascript
// 檢查WebSocket連接
function checkConnectionStatus() {
    const client = window.realtimeClient;
    if (!client) {
        console.log('❌ realtimeClient 未初始化');
        return;
    }
    
    console.log('🔍 連接狀態檢查:');
    console.log('isConnected:', client.isConnected);
    console.log('socket.connected:', client.socket?.connected);
    console.log('socket.id:', client.socket?.id);
    console.log('currentRoomId:', client.currentRoomId);
    console.log('currentUserId:', client.currentUserId);
    console.log('currentUsername:', client.currentUsername);
}

checkConnectionStatus();
```

### 3. 語音功能測試

```javascript
// 測試語音功能可用性
function testVoiceFeatures() {
    console.log('🎤 語音功能測試:');
    
    // 檢查瀏覽器支持
    const hasWebRTC = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    console.log('WebRTC支持:', hasWebRTC ? '✓' : '✗');
    
    const hasAudioContext = !!(window.AudioContext || window.webkitAudioContext);
    console.log('AudioContext支持:', hasAudioContext ? '✓' : '✗');
    
    const hasWebSocket = !!window.WebSocket;
    console.log('WebSocket支持:', hasWebSocket ? '✓' : '✗');
    
    // 檢查功能管理器
    if (typeof voiceCallManager !== 'undefined') {
        console.log('語音通話管理器:', '✓ 已加載');
        console.log('通話狀態:', voiceCallManager.isCallActive ? '進行中' : '未開始');
    } else {
        console.log('語音通話管理器:', '✗ 未加載');
    }
    
    if (typeof voiceTranscriptionManager !== 'undefined') {
        console.log('語音轉錄管理器:', '✓ 已加載');
        console.log('轉錄狀態:', voiceTranscriptionManager.isActive ? '活躍' : '未活躍');
    } else {
        console.log('語音轉錄管理器:', '✗ 未加載');
    }
}

testVoiceFeatures();
```

### 4. 手動觸發功能測試

```javascript
// 手動測試語音通話功能
function manualVoiceTest() {
    if (typeof toggleVoiceCall === 'function') {
        console.log('🎯 手動觸發語音通話...');
        toggleVoiceCall();
    } else {
        console.log('❌ toggleVoiceCall 函數未定義');
    }
}

// 手動測試轉錄功能  
function manualTranscriptionTest() {
    if (typeof toggleTranscription === 'function') {
        console.log('🎯 手動觸發語音轉錄...');
        toggleTranscription();
    } else {
        console.log('❌ toggleTranscription 函數未定義');
    }
}

// 運行測試
// manualVoiceTest();
// manualTranscriptionTest();
```

## 🐛 常見問題解決

### 問題1: 麥克風權限被拒絕
**解決方案:**
1. 檢查瀏覽器地址欄左側的權限圖標
2. 點擊並設置麥克風為"允許"
3. 刷新頁面重試

### 問題2: WebSocket連接失敗
**解決方案:**
```javascript
// 檢查並重新連接
if (window.realtimeClient && !window.realtimeClient.isConnected) {
    console.log('嘗試重新連接...');
    window.realtimeClient.connect();
}
```

### 問題3: 語音功能未初始化
**解決方案:**
```javascript
// 手動重新初始化
if (typeof initializeVoiceFeatures === 'function') {
    console.log('重新初始化語音功能...');
    initializeVoiceFeatures();
} else {
    console.log('請刷新頁面');
}
```

### 問題4: 全局變數未定義
**解決方案:**
```javascript
// 檢查全局變數
console.log('全局變數檢查:');
console.log('roomId:', typeof roomId !== 'undefined' ? roomId : '未定義');
console.log('currentUserId:', typeof currentUserId !== 'undefined' ? currentUserId : '未定義');
console.log('currentUsername:', typeof currentUsername !== 'undefined' ? currentUsername : '未定義');

// 如果未定義，嘗試從現有會話獲取
if (typeof roomId === 'undefined' && window.realtimeClient) {
    window.roomId = window.realtimeClient.currentRoomId;
    window.currentUserId = window.realtimeClient.currentUserId;
    window.currentUsername = window.realtimeClient.currentUsername;
}
```

## 📝 測試清單

- [ ] 頁面加載正常，無JavaScript錯誤
- [ ] realtimeClient已初始化
- [ ] WebSocket連接正常
- [ ] 語音功能管理器已加載
- [ ] 點擊語音通話按鈕無錯誤
- [ ] 麥克風權限請求正常
- [ ] 語音轉錄按鈕響應正常
- [ ] 控制台無"socket is not defined"錯誤

## 🎉 成功標誌

如果看到以下日誌，說明功能正常：
```
語音功能已初始化
開始語音通話...
語音通話已開始
```

而不是：
```
開始語音通話失敗: ReferenceError: socket is not defined
```

## 📞 如需幫助

如果仍然遇到問題，請：
1. 提供控制台完整錯誤信息
2. 運行上述測試代碼並提供輸出結果
3. 說明使用的瀏覽器版本和操作系統
