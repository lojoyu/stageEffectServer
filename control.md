# 舞台效果控制器 - 控制端 (Controller) 開發指南

本文檔旨在為控制端 (Controller) 的開發者提供與舞台效果伺服器互動的指南。控制端的主要職責是向伺服器發送指令，以觸發和管理連接到伺服器的接收端 (Receiver) 上的各種效果。

## 連接伺服器

控制端需要通過 Socket.IO 連接到伺服器的 `/controller` 命名空間。

**伺服器端點**: `[您的伺服器地址]/controller` (例如 `ws://localhost:8000/controller`)

## 向伺服器發送指令 (Controller -> Server)

控制端可以通過向伺服器發送以下 Socket.IO 事件來控制效果：

### 1. `controlData`

這是觸發主要舞台效果的核心指令。

-   **事件名**: `controlData`
-   **目的**: 發送效果數據和模式給接收端。
-   **數據結構**:
    ```json
    {
      "mode": {
        "type": "normal" | "taketurn", // 效果模式
        "interval": 0, // 間隔時間 (毫秒)。0 表示只執行一次。
        "percentage": 1.0 // (可選, 僅 normal 模式) 影響的接收端比例 (0.0 到 1.0)
      },
      "data": {
        // 具體的效果參數，結構取決於接收端的實現
        // 例如：
        // "color": "red",
        // "intensity": 0.8,
        // "pattern": "blink"
      }
    }
    ```
-   **伺服器行為**:
    -   **`mode.interval == 0`**: 伺服器會立即向接收端發送一次 `data`。
        -   如果 `mode.type == "normal"` 且 `mode.percentage` 小於 1，則隨機選擇指定比例的接收端。
        -   如果 `mode.type == "taketurn"`，則向當前輪到的接收端發送。
    -   **`mode.interval > 0`**:
        -   **`mode.type == "normal"`**: 伺服器會以 `mode.interval` 的間隔，週期性地向接收端（根據 `mode.percentage` 選擇）發送 `data`。
        -   **`mode.type == "taketurn"`**: 伺服器會以 `mode.interval` 的間隔，輪流向每個接收端發送 `data`。`emitInfo.taketurnId` 會被初始化為 0。

### 2. `showClient`

-   **事件名**: `showClient`
-   **目的**: 請求當前已連接的接收端列表。（和 speakConfig showUser 差在哪？）
-   **數據結構**:
    ```json
    {
      "order": "asc" | "desc" | "middle" | "random" | Array<Object> // 排序方式
      // "asc": 按連接時間升序
      // "desc": 按連接時間降序
      // "middle": 從中間向兩側排列
      // "random": 隨機排序
      // Array<Object>: 自定義排序權重，例如 [{id: "client_uuid_1", value: 1}, {id: "client_uuid_2", value: 0}]
    }
    ```
-   **伺服器行為**: 伺服器會根據指定的 `order` 排序已連接的接收端，並通過 `showClient` 事件將列表回傳給發送請求的控制端。

### 3. `speak`

-   **事件名**: `speak`
-   **目的**: 讓一個或多個接收端播放簡單的語音。
-   **數據結構**:
    ```json
    {
      "text": "您好，這是一段測試語音。" // 要播放的文本
    }
    ```
-   **伺服器行為**:
    -   伺服器會將 `text` 按標點符號分割成句子。
    -   預設情況下，會選擇輪流順序中的第一個接收端（或根據 `emitInfo.sortArray` 排序後的第一個）來播放第一句。
    -   伺服器會管理句子的播放順序和接收端的輪換（如果有多個句子或需要多個接收端）。
    -   播放完成後，伺服器會向控制端發送 `speakOver` 事件。

### 4. `speakAdvance`

-   **事件名**: `speakAdvance`
-   **目的**: 讓指定比例的接收端同時或輪流播放語音，並可配置語音參數。
-   **數據結構**:
    ```json
    {
      "text": "這是一段進階語音測試。", // 要播放的文本
      "percentage": 0.5, // (可選) 參與播放的接收端比例 (0.0 到 1.0)。如果為 0 或未提供，則行為類似 `speak`。
      "rate": 1.0,       // (可選) 語速 (預設 1.0)
      "pitch": 1.0,      // (可選) 音高 (預設 1.0)
      "volume": 1.0,     // (可選) 音量 (預設 1.0)
      "voice": "Google 普通话（中国大陆）", // (可選) 指定語音，如果接收端支持
      "sortArray": "asc" | "desc" | "middle" | "random" | Array<Object> // (可選) 選擇接收端時的排序方式
    }
    ```
-   **伺服器行為**:
    -   如果 `percentage` 大於 0，伺服器會根據 `percentage` 和 `sortArray` 選擇一定數量的接收端。
    -   伺服器會將 `text` 分割成句子，並協調這些接收端播放。
    -   `rate`, `pitch`, `volume`, `voice` 等參數會傳遞給接收端用於語音合成。
    -   播放完成後，伺服器會向控制端發送 `speakOver` 事件。

### 5. `speakConfig`

-   **事件名**: `speakConfig`
-   **目的**: 配置全域語音相關參數或請求接收端語音信息。
-   **數據結構 (示例)**:
    -   **更改語音超時參數**:
        ```json
        {
          "mode": "changeTimeout",
          "timeoutspeed": 100, // 每字符超時時間 (毫秒)
          "timeoutdelay": 2000 // 基礎超時延遲 (毫秒)
        }
        ```
    -   **請求顯示接收端語音選擇**:
        ```json
        {
          "mode": "showUser"
        }
        ```
        伺服器會回傳一個包含 `socket.id` 到語音名稱映射的物件。
    -   **廣播語音變更給所有接收端 (例如，統一更改預設語音)**:
        ```json
        {
          "mode": "changeVoice", // 或其他接收端支持的 speakConfig 模式
          "voice": "新的預設語音名稱"
        }
        ```
    -   **指定接收端的語音**:
        ```json
        {
          "mode": "assignVoice",
          "socketId": "a_specific_receiver_socket_id", // (可選) 如果省略，則會應用於所有接收端
          "voice": "要指定的語音名稱或物件"
        }
        ```
-   **伺服器行為**:
    -   `changeTimeout`: 更新伺服器內部計算語音播放超時的參數。
    -   `showUser`: 伺服器會將 `socketToVoice`（記錄了各接收端選擇的語音）回傳給發送請求的控制端。
    -   `assignVoice`: 如果提供 `socketId`，伺服器會更新內部狀態，記錄指定接收端的語音偏好，並單獨向該接收端發送 `changeVoice` 指令。如果省略 `socketId`，伺服器會更新所有已連接接收端的語音偏好，並廣播 `changeVoice` 指令給所有接收端。
    -   其他 `mode`: 伺服器會將該 `speakConfig` 指令廣播給所有 `/receiver` 命名空間下的接收端。

### 6. `pause` (目前功能有限)

-   **事件名**: `pause`
-   **目的**: (推測) 用於暫停某些伺服器活動。目前伺服器僅將此事件回傳給發送者。
-   **數據結構**: 任意數據。

## 監聽來自伺服器的事件 (Server -> Controller)

控制端應監聽以下來自伺服器的 Socket.IO 事件：

### 1. `debug`

-   **事件名**: `debug`
-   **目的**: 接收來自伺服器的調試信息或歡迎訊息。
-   **數據**: 通常是字符串。

### 2. `userConnect`

-   **事件名**: `userConnect`
-   **目的**: 通知控制端有新的接收端 (receiver) 連接到伺服器。
-   **數據**: 通常是一個指示性字符串，例如 `'userConnect'`。

### 3. `osc`

-   **事件名**: `osc`
-   **目的**: 接收從 `/user` 命名空間轉發過來的 OSC (Open Sound Control) 數據。
-   **數據**: OSC 數據包，具體結構取決於發送方。

### 4. `showClient` (回應 `showClient` 請求)

-   **事件名**: `showClient`
-   **目的**: 接收請求的客戶端列表。
-   **數據**: 一個包含客戶端信息的陣列，通常是 `socket.id` 列表或更詳細的對象列表，根據伺服器端 `getClientsByOrder` 函數的實現。

### 5. `speakOver`

-   **事件名**: `speakOver`
-   **目的**: 通知控制端，之前由 `speak` 或 `speakAdvance` 觸發的語音播放任務已全部完成。
-   **數據**: 通常是一個指示性字符串，例如 `'speakOver'`。

### 6. `speakConfig` (回應 `speakConfig` 請求，例如 `showUser`)

-   **事件名**: `speakConfig`
-   **目的**: 接收請求的語音配置信息。
-   **數據**: 根據請求的 `mode` 而定。例如，對於 `showUser`，會是 `socketToVoice` 對象。

## 注意事項

-   **全局狀態 `emitInfo`**: 伺服器使用一個名為 `emitInfo` 的全局對象來追蹤當前效果的狀態（如模式、間隔時間、輪流ID等）。控制端的指令會直接或間接修改此對象。
-   **錯誤處理**: 本文檔未詳細說明錯誤處理機制。開發控制端時，應考慮實現適當的錯誤處理和超時邏輯。
-   **接收端實現**: 許多效果的具體表現取決於接收端的實現。控制端發送的 `data` 應與接收端期望的格式一致。