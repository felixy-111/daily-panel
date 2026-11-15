# 公開 repo 的隱私保護
Feature: 隱私
  為了把程式放在公開 repo 也不洩漏個人習慣
  身為面板主人
  我要習慣名稱只在登入後從資料庫載入

  Scenario: 未登入只看到登入框
    Given 我沒有登入
    When 我打開面板網址
    Then 只看到 Email／密碼登入框與「忘記密碼？」
    And 看不到任何習慣格

  Scenario: 原始碼不含習慣名稱
    When 我搜尋 index.html logic.js sw.js manifest.webmanifest features/
    Then 找不到任何私人習慣名稱
    And 程式只用 id：shadowing anki meeting email m1 m2 b1 b2 b3

  Scenario: 匿名金鑰查不到資料
    When 只用 anon key（未登入）查 habit_logs habit_defs habit_source_status
    Then 回傳 0 筆

  Scenario: 不能自行註冊
    When 有人用 anon key 呼叫註冊
    Then 註冊被拒（Supabase 已關公開註冊）

  Scenario: 收集器 log 不印名稱
    When GitHub Actions 收集器執行
    Then log 只印筆數，不印習慣名稱或 Notion 內容
