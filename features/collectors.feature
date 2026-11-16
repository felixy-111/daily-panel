# 英文四項自動收集（Mac 收集器＋雲端收集器）
Feature: 自動收集
  為了不必手動打卡英文練習
  身為面板主人
  我要收集器自動把 shadowing anki meeting email 寫進帳本

  Scenario: 排除測試資料
    Given shadowing 紀錄裡有 test_zoo 的測試項目
    When Mac 收集器執行
    Then test_zoo 不被計入

  Scenario: meeting 用 sessions 的日期自算
    Given meeting_coach_state 的 streak 數字有誤
    When Mac 收集器執行
    Then 以 sessions[].date 計算每天是否完成

  Scenario: 重跑不重複
    When Mac 收集器連續執行兩次
    Then habit_logs 的列數不變

  Scenario: 未達 min_value 不算完成
    Given anki 的 min_value 是 1
    And 今天 anki 複習 0 張
    Then anki 格不顯示完成

  Scenario: Anki 沒開 → 灰格未知
    Given anki 的 last_success_at 超過 90 分鐘前
    And 今天沒有任何 anki 完成紀錄
    Then anki 格顯示灰色「未知・最後更新 HH:MM」

  Scenario: Mac 關機一天 → 開機後回補
    Given Mac 關機一整天
    When Mac 開機、收集器補跑近 14 天
    Then 昨天的 shadowing 被補上

  Scenario: 未知時仍可手動補點
    Given shadowing 格顯示未知
    When 我點 shadowing 格
    Then shadowing 顯示完成（面板來源）

  Scenario: Email Coach 超過 3 小時沒更新 → 未知
    Given email_coach 的 last_success_at 是 3 小時又 1 分鐘前
    And 今天沒有 email 完成紀錄
    Then email 格顯示未知

  Scenario: Email 日期歸屬到出題日
    Given 2026-11-20 07:xx 寄出當天題目
    And 我在 2026-11-20 23:50 回信
    And 批改在 2026-11-21 00:40 完成
    Then email 記到 2026-11-20

  Scenario: Anki 不顯示到期數（2026-11-16 拿掉：門檻只是複習 1 張，大數字勸退）
    Given anki 的 habit_source_status extra 有到期張數
    Then anki 格不顯示到期張數

  Scenario: Notion 英文任務不接
    When 我在 Notion 勾 Podcast Shadowing 任務
    Then shadowing 格不受影響
