# 專案概述
此專案是一個基於 Node.js 和 Socket.IO 的即時通訊伺服器，旨在控制和同步多個客戶端（接收端）的舞台效果。一個或多個控制端可以發送指令，而接收端則根據這些指令執行相應的動作，例如燈光變化、播放聲音（特別是語音合成）等。

# 主要技術棧
Node.js: JavaScript 執行環境。
HTTP: Node.js 內建的 HTTP 模組，用於建立基礎的 HTTP 伺服器。
Socket.IO: 用於實現 WebSocket 即時通訊，提供可靠的雙向事件傳遞。

# 核心組件與功能
###  1. 伺服器設定 (Server Setup)
- HTTP 伺服器建立:

```javascript
const http = require('http');
const server = http.createServer();
```
建立一個基礎的 HTTP 伺服器實例。

Socket.IO 伺服器初始化:

```javascript
const Server = require('socket.io').Server;
const io = new Server(server, {
    cors: {
      origin: 'http://localhost:5173',  // 允許本地 Vite 開發伺服器的跨域請求
      methods: ['GET', 'POST'],
      credentials: true                // 允許攜帶 cookie 或授權標頭
    }
  });
```
將 Socket.IO 附加到 HTTP 伺服器上，並設定 CORS (Cross-Origin Resource Sharing) 策略，允許特定來源（例如前端開發伺服器）的連線。

命名空間 (Namespaces): 伺服器定義了三個 Socket.IO 命名空間，用於區分不同類型的客戶端連線和通訊頻道：

- receiver = io.of('/receiver'): 用於連接執行舞台效果的客戶端（例如，瀏覽器頁面、硬體設備）。
- controller = io.of('/controller'): 用於連接發送控制指令的客戶端（例如，控制台介面）。
- user = io.of('/user'): 似乎是用於一般用戶或其他類型的客戶端，目前主要用於轉發 OSC (Open Sound Control) 訊息。

### 2. 全域狀態管理 (Global State)
伺服器使用一些全域變數來追蹤和管理連線狀態及效果參數：

- emitInfo: 一個物件，儲存當前效果的相關資訊，包含：

    - loop: (似乎未使用) 循環計時器。
    - intervalTime: 效果發送的間隔時間。
    - data: 當前效果的數據內容。
    - waiting: 標記是否正在等待下一次間隔發送。
    - mode: 當前效果的模式（例如 normal, taketurn, speak）。
    - taketurnId: 在「輪流 (taketurn)」模式下，當前輪到的客戶端 ID 或索引。
    - reverse: 排序方向。
    - sortArray: 用於客戶端排序的陣列或物件。
    - timeout: 語音播放的超時計時器。
    - timeoutdelay, timeoutspeed: 語音超時計算的相關參數。
    - nowSpeak: (用於 speak 模式) 當前正在說話的客戶端資訊。
    - waitforNum: (用於 speak 模式) 等待多少個客戶端完成說話。
- connectIndex: 一個計數器，用於為新連接的 receiver 分配唯一索引 (後來改用 Date.now() 作為索引)。
- socketToIndex: 一個物件，映射 receiver 的 socket.id 到其唯一索引。
- socketToVoice: 一個物件，映射 receiver 的 socket.id 到其選擇的語音。

- uuidToIndex: 一個物件，映射 receiver 的 UUID 到其唯一索引，確保同一個 receiver 重新連接時能保持某種程度的一致性。

### 3. /receiver 命名空間 (Receiver Namespace)
此命名空間處理來自接收端客戶端的連線和事件。

- connection 事件:

    - 當一個新的 receiver 連線時觸發。
    - 監聽來自該 receiver 的 connected 事件，其中包含 receiver 的 uuid。
    - 如果 uuid 是新的，則為其分配一個唯一索引 (使用 Date.now())。
    - 通知 /controller 命名空間有新的用戶連接 (controller.emit('userConnect', 'userConnect'))。

- disconnect 事件:

    - 當 receiver 斷開連線時觸發。
    - 從 socketToIndex 中刪除該 receiver 的記錄。

- speakConfig 事件:

    - 接收來自 receiver 的語音設定變更，例如 changeVoice。
    - receiverOnSpeakConfig(data, socket.id): 處理此事件，更新 socketToVoice。

- speakOver 事件:

    - 當 receiver 完成一次語音播放時觸發。
    - receiverOnSpeakover(data): 處理此事件。檢查是否是預期的 taketurnId，並減少 emitInfo.waitforNum。如果所有預期的 receiver 都已完成，則清除超時計時器並觸發 nextSpeak()。
- debug 事件:

    - 接收來自 receiver 的 debug 訊息，並將其回傳給該 receiver。

### 4. /user 命名空間 (User Namespace)
此命名空間處理來自一般用戶或其他類型客戶端的連線。

- connection 事件:

    - 當一個新的 user 連線時觸發，僅記錄日誌。
- osc 事件:
    - 接收來自 user 的 OSC 數據。
    - 將接收到的 OSC 數據轉發給 /controller 命名空間 (controller.emit('osc', data))。

### 5. /controller 命名空間 (Controller Namespace)
此命名空間處理來自控制端客戶端的連線和指令。

- connection 事件:

    - 當一個新的 controller 連線時觸發。
    - 向該 controller 發送歡迎訊息 (controller.emit('debug', 'welcome!'))。

- controlData 事件:

    - 接收來自 controller 的主要控制指令。
    - 指令中應包含 mode (效果模式) 和具體的 data (效果參數)。
    - 根據 mode.type 執行不同邏輯：
        - mode.interval == 0: 效果只執行一次 (receiverEmit())。
        - mode.type == "normal": 如果沒有正在等待的間隔，則啟動 emitDataWithNextTime() 進行週期性發送。
        - mode.type == "taketurn": 初始化輪流模式的參數 (emitInfo.taketurnId = 0)，並啟動 emitDataWithNextTime()。

- showClient 事件:

    - 接收來自 controller 的請求，要求顯示已連接的 receiver 列表。
    - getClientsByOrder(order): 根據指定的順序獲取 receiver 列表。
    - 將列表回傳給發送請求的 controller。
- pause 事件:

    - 接收來自 controller 的 pause 指令，並將其回傳給該 controller (目前看來功能不完整或用於未來擴展)。
- speak 事件:

    - 接收來自 controller 的簡單語音指令（包含要說的文本）。
    - controllerOnSpeak(data): 處理此指令，將文本轉換為句子，選擇一個 receiver (預設是輪流中的第一個)，並透過 emitSpeak() 發送語音指令。
- speakAdvance 事件:

    - 接收來自 controller 的進階語音指令（包含文本、發聲者比例 percentage、語速 rate、音高 pitch 等）。
    - controllerOnSpeakAdvance(data): 處理此指令。如果 percentage 為 0 或未提供，則退化為 controllerOnSpeak。否則，根據 percentage 選擇一定比例的 receiver，並向它們發送語音指令。
- speakConfig 事件:

    - 接收來自 controller 的語音相關設定指令。
    - controllerOnSpeakConfig(data, socket): 處理此指令。
        - mode == 'changeTimeout': 修改語音超時的 timeoutspeed 和 timeoutdelay。
        - mode == 'showUser': 將 socketToVoice (記錄了各 receiver 選擇的語音) 回傳給 controller。
        - 其他 mode (例如 changeVoice): 將設定廣播給所有 receiver。
        
### 6. 核心邏輯與輔助函式 (Core Logic & Helper Functions)
語音處理 (Speech Handling):

txtToSentence(text): 將輸入的文本按標點符號（, . ? ! : ;）分割成句子陣列。
controllerOnSpeak(data) / controllerOnSpeakAdvance(data): 初始化語音任務，設定 emitInfo 中的相關參數（如 sentences, sentenceId, waitforNum, sortArray），並呼叫 emitSpeak() 發送第一句。
receiverOnSpeakover(data): 當 receiver 完成一句話後，檢查是否所有指定的 receiver 都已完成。若是，則呼叫 nextSpeak()。
nextSpeak(): 準備並發送下一句話。根據模式（單人或按比例多人）選擇 receiver，更新 emitInfo.taketurnId 和 emitInfo.sentenceId。如果所有句子都已說完，則通知 controller (controller.emit('speakOver', 'speakOver'))。
emitSpeak(sender, data): 向指定的 sender (一個或多個 receiver) 發送 speak 事件，包含句子 ID 和文本。同時設定一個超時計時器 emitInfo.timeout。如果超時，則呼叫 speakTimeout()。
speakTimeout(id): 如果在預期時間內未收到 speakOver 事件，則強制觸發 nextSpeak()。
controllerOnSpeakConfig(data, socket) / receiverOnSpeakConfig(data, socketId): 處理語音相關的配置，如更改語音、顯示用戶語音選擇、調整超時參數等。
效果發送 (Effect Emission):

emitDataWithNextTime(): 如果 emitInfo.intervalTime 大于 0，則會重複執行。它首先呼叫 receiverEmit() 發送當前效果數據，然後設定一個 setTimeout 在 emitInfo.intervalTime 毫秒後再次呼叫自己，實現週期性發送。
receiverEmit(): 根據 emitInfo.mode.type 決定如何向 receiver 發送 controlData：
normal 模式: 如果設定了 percentage < 1，則只向選定比例的 receiver 發送。否則，向所有 receiver 廣播。
taketurn 模式: 根據 emitInfo.taketurnId 和 getClientsByOrder() 獲取的客戶端列表，選擇當前輪到的 receiver(s) 並向其發送數據。然後 emitInfo.taketurnId 遞增，如果超出客戶端數量則重置為 0，並停止間隔發送。
客戶端選擇與排序 (Client Selection & Sorting):

getReceiverClients(): 獲取所有已連接到 /receiver 命名空間的客戶端 socket.id 列表。
getPercentageClients(percentage): 從所有 receiver 中隨機選取指定百分比的客戶端。
getClientsByOrder(order): 根據 order 參數對 receiver 進行排序和選擇：
order 為數字: 按 socketToIndex 的值（連接時間戳）升序或降序排序。
order 為陣列: 按照陣列中指定的順序值為客戶端賦予排序權重。
order == "middle": 將客戶端從中間向兩側分組排列。
getTaketurnSender(clientsArr, sender, id): 根據 id 從 clientsArr 中選擇一個或多個客戶端，並構建 Socket.IO 的 to()鏈，用於向特定客戶端發送。同時會記錄正在說話的客戶端語音。
getSender(clientsArr, sender): 將 clientsArr 中的所有客戶端加入到 sender 的 to() 鏈中。
indexsort(a, b): 排序函式，用於按 emitInfo.sortArray 中的值排序。
randomsort(a, b): 隨機排序函式。
7. 伺服器啟動
```javascript
server.listen(port, () => {
    console.log("Listening on %d", server.address().port);
});
```
伺服器監聽指定的 port (預設為 8000 或環境變數 PORT 的值)。

8. 開發/調試輔助 (Development/Debug Section)
程式碼末尾註解掉的部分使用了 prompts 模組，這是一個用於在終端機中創建交互式提示的工具。這段程式碼提供了一個命令列介面 (CLI)，讓開發者可以直接在終端機輸入指令來測試伺服器的各種功能，例如：

speak: 觸發簡單語音。
speakAdvance: 觸發進階語音。
speakover: 手動模擬 receiver 完成語音。
text: 測試 txtToSentence 函式。
這對於開發和調試伺服器邏輯非常有用，而不需要依賴完整的前端控制介面。

總結
該伺服器是一個事件驅動的系統，用於管理和同步多個客戶端的舞台效果。它通過 Socket.IO 命名空間區分不同角色的客戶端，並使用全域狀態來追蹤當前效果的模式和參數。核心功能包括：

客戶端連接管理: 追蹤 receiver 和 controller 的連接狀態。
效果指令分發: 根據 controller 發送的指令（包含模式和數據），將效果數據發送給一個或多個 receiver。
模式支持:
Normal: 週期性地向指定比例或全部 receiver 發送數據。
Taketurn: 輪流向 receiver 發送數據。
語音合成控制 (Text-to-Speech):
將文本分割成句子。
可以指定單個 receiver、按比例選擇多個 receiver 或輪流讓 receiver 說話。
處理 receiver 完成說話的通知，並觸發下一個動作。
包含超時機制，防止流程卡住。
允許配置語音參數（如語音選擇、語速、音高等）。
OSC 訊息轉發: 從 /user 命名空間接收 OSC 訊息並轉發給 /controller。
此系統為需要即時協調和控制多個終端行為的應用場景（如互動藝術裝置、現場表演控制等）提供了一個靈活的後端基礎。