# Notion 雙向：讀取（收集器）＋寫回（Edge Function notion-writeback）
Feature: Notion 打卡入口
  為了用原本的 Notion 方式記錄也能反映在面板
  身為面板主人
  我要 Notion 與面板兩邊打卡都算數

  Background:
    Given m1 m2 b1 b2 b3 在 habit_defs 有 notion_page_id 白名單

  # --- Notion 勾選 → 面板 ---
  Scenario: Notion 勾 b1 → 面板完成並標示來源
    When 我在 Notion 把 b1 的每日任務勾 Done
    And 雲端收集器跑完
    Then 面板 b1 顯示完成
    And b1 格有「N」來源標示

  Scenario: Notion 勾 m2 但沒填 Value → 視為達標
    When 我在 Notion 勾 m2 Done 且 Value 空白
    Then 面板 m2 顯示「108/108」完成

  Scenario: Notion 凌晨 02:10 勾選 → 算前一天
    When 我在台北時間 2026-11-21 02:10 於 Notion 勾 b3
    Then habit_logs 寫入 log_date 2026-11-20

  Scenario: 原任務已回 To Do 仍算完成
    Given Notion automation 已把 b1 原任務推回 To Do
    And 今天有一筆 b1 的 Done 歷史頁
    Then 面板 b1 仍顯示完成

  # --- 兩邊都記 ---
  Scenario: 面板 20 分＋Notion 也勾 → 完成 20 分、熱力圖一格
    Given 面板 b3 記 20 分鐘
    And Notion 也勾了 b3
    Then b3 顯示完成 20 分鐘
    And 熱力圖當天 b3 只有一格完成

  Scenario: 面板 54＋Notion 勾 → 完成且保留 54
    Given 面板 m2 記 54
    And Notion 也勾了 m2
    Then m2 顯示完成，數字保留 54

  Scenario: 面板取消但 Notion 有勾 → 仍完成並提示
    Given Notion 已勾 m1
    When 我在面板取消 m1
    Then m1 仍顯示完成
    And 格子顯示小提示「Notion 已勾選」

  # --- 批次清帳 ---
  Scenario: 一分鐘內連勾五次 → 只算今天一次
    When 我在 Notion 一分鐘內把 b1 勾了五次
    Then 今天 b1 只有一筆 notion 紀錄

  Scenario: 4 天前的 Completed 被忽略並註記
    Given 有一筆 b2 歷史頁的 Completed 是 4 天前
    Then 收集器不寫入 habit_logs
    And habit_source_status 的 extra 記下忽略筆數

  Scenario: 上線前的歷史不匯入
    Given Notion 有上線日之前完成的歷史頁
    Then 這些歷史頁不會出現在 habit_logs

  # --- 改名 / 讀不到 ---
  Scenario: Notion 任務改名仍對應
    When 我把 b1 的 Notion 任務改名
    Then 收集器仍用頁面 ID 對應到 b1

  Scenario: Tasks 未分享給 integration → 紅色橫幅、打卡照常
    Given 收集器讀不到原任務
    Then habit_source_status 的 notion message 以 ERROR 開頭
    And 面板頂端顯示紅色橫幅
    And 沒有面板紀錄的 m1 m2 b1 b2 b3 顯示「未知」
    And 面板打卡照常可用

  Scenario: 任務被封存 → 指出哪一項
    Given b2 的原任務被封存
    Then 紅色橫幅的訊息指出 b2

  Scenario: Notion token 失效 → GitHub 失敗信
    Given Notion token 被撤銷
    When 雲端收集器執行
    Then GitHub Actions 執行失敗並寄出失敗通知信

  Scenario: Simple 與 Advanced automation 同開
    Given 一次勾選讓 Due 被推了兩次
    Then 當天計數仍只算一次

  # --- 面板 → Notion 寫回 ---
  Scenario: 面板打卡 m1 → Notion 產生今天的歷史頁
    When 我在面板點 m1
    Then 面板呼叫 notion-writeback 並帶登入憑證
    And Notion 產生今天的歷史頁、原任務 Due 只推一次

  Scenario: 面板填 m2 54 → Notion 歷史頁 Value=54
    When 我在面板把 m2 記 54
    Then 對應的 Notion 歷史頁 Value 是 54

  Scenario: 面板取消 → 當天歷史頁封存
    Given 面板 m1 已寫回 Notion
    When 我在面板取消 m1
    Then Notion 當天那筆歷史頁被封存

  Scenario: 寫回失敗 → 標示並重試、不擋打卡
    Given notion-writeback 呼叫失敗
    When 我在面板點 b1
    Then b1 照樣顯示完成並寫進 Supabase
    And b1 格顯示「Notion 未同步」
    And 下次上線或回到面板時自動重試

  Scenario: 寫回產生的歷史頁不被重複計入
    Given 寫回產生的歷史頁 ID 已存在 source_ref
    When 雲端收集器讀到這筆歷史頁
    Then 略過，不另寫 notion 紀錄

  Scenario: 非白名單頁面被拒
    When 有人呼叫 notion-writeback 指定不在白名單的 habit
    Then 函式回傳錯誤且不改 Notion

  Scenario: 未登入呼叫寫回被拒
    When 不帶有效登入憑證呼叫 notion-writeback
    Then 函式回傳 401

  # --- Notion 數字 ---
  Scenario: Notion 填 Value=5 再勾 b2 → 面板 5
    When 我在 Notion 填 b2 Value=5 再勾 Done
    Then 面板 b2 顯示 5 加上 habit_defs 的單位

  Scenario: Value 沒被 automation 複製 → 搬到歷史頁並清空原任務
    Given 新歷史頁沒有 Value、原任務 Value=5
    When 雲端收集器執行
    Then 歷史頁 Value 被寫成 5
    And 原任務 Value 被清空
