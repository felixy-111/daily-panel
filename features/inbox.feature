# 收件匣投信口（Edge Function inbox-capture）
# 面板是「投信口」不是「信箱」：只負責把一行字送進 Notion Tasks 收件匣，不存、不列、不整理。
Feature: 收件匣投信口
  為了想到雜事時不離開面板就能先放下
  身為面板主人
  我要輸入一行字就送進 Notion 收件匣

  Background:
    Given 我已登入且在「今日」畫面

  Scenario: 一行送出
    When 我點上方的「＋收件匣」
    Then 出現一行文字框（不是瀏覽器彈窗），沒有其他欄位
    When 我輸入一行字並按 Enter
    Then 文字框清空
    And 顯示「已送到收件匣」約 2 秒

  Scenario: 出現在 Notion 收件匣
    When 我送出一行字
    Then Notion Tasks 多一頁，只有標題（Name）
    And 該頁狀態是 To Do、沒有到期日與專案，落在 Ultimate Brain 的 Inbox

  Scenario: 面板不留清單
    When 我送出一行字
    Then 面板上找不到剛才的內容
    And 面板沒有待辦清單、勾選、分類、到期日

  Scenario: 空白不送
    When 我只輸入空白並按 Enter
    Then 沒有任何東西被送出

  Scenario: 太長擋下
    When 我輸入 501 個字並按 Enter
    Then 顯示太長的提示，文字留在框裡
    And 沒有任何東西被送出

  Scenario: 九格不被擠掉
    When 我在 360x640 的手機畫面打開「今日」
    Then 文字框預設是收起來的
    And 9 個習慣格全部可見，頁面不需要捲動

  Scenario: 離線先存
    Given 手機沒有網路
    When 我送出一行字
    Then 文字先存進本機佇列
    And 按鈕顯示「待送 1」，但不顯示內容

  Scenario: 上線補送
    Given 本機佇列有 2 則待送
    When 網路恢復
    Then 2 則依序自動送出
    And 「待送」標示消失

  Scenario: Notion 失敗不丟字
    Given Notion 暫時連不上（Edge Function 回 502）
    When 我送出一行字
    Then 文字留在本機佇列，顯示「待送 1」
    When Notion 恢復後面板再次同步
    Then 該則送出

  Scenario: 非本人 403
    When 不在 habit_owner 名單的帳號呼叫 inbox-capture
    Then 回 403，Notion 沒有新增任何頁

  Scenario: 未登入 401
    When 沒帶登入憑證呼叫 inbox-capture
    Then 回 401

  Scenario: 紀錄不含內容
    When inbox-capture 成功或失敗
    Then 雲端紀錄只有狀態碼，沒有文字內容與 Notion token

  Scenario: repo 不含內容
    When 我搜尋 repo 內所有進版控的檔案
    Then 找不到任何丟進收件匣的文字

  Scenario: 登出有待送先警告
    Given 本機佇列有 1 則待送
    When 我按登出
    Then 先出現確認，說明有 1 筆會消失
