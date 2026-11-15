# 今日總覽＋跨日（4 點換日）
# 習慣只用 id 稱呼：shadowing anki meeting email m1 m2 b1 b2 b3；顯示名稱登入後才從 habit_defs 載入
Feature: 今日總覽
  為了一眼看完今天做了什麼
  身為面板主人
  我要一頁看到 9 個習慣，不必捲動

  Background:
    Given 我已登入
    And habit_defs 有 9 筆習慣

  Scenario: 一頁 9 格不捲動
    When 我在 360x640 的手機畫面打開「今日」
    Then 9 個習慣格全部可見
    And 頁面不需要捲動

  Scenario: 先顯示快取再更新
    Given 上次開啟時的資料存在本機快取
    When 我打開面板
    Then 立刻看到快取的打卡狀態
    And 背景向 Supabase 取得最新資料後畫面更新
    When 我切到別的 App 再切回來
    Then 面板重新抓一次資料

  Scenario: 每週型習慣顯示本週進度、不警示
    Given b1 的 weekly_target 是 3
    And 本週（週一到週日）b1 已完成 1 天
    And 今天 b1 尚未完成
    Then b1 格顯示「本週 1/3」
    And b1 格不使用失敗或警示樣式

  Scenario: 凌晨 01:30 打卡記到前一天
    Given 台北時間是 2026-11-21 01:30
    When 我在面板點 m1
    Then 寫入的 log_date 是 2026-11-20

  Scenario: 04:01 顯示新的一天
    Given 台北時間是 2026-11-21 04:01
    When 我打開面板
    Then 「今天」是 2026-11-21
    And 所有格子是今天尚未打卡的狀態

  Scenario: 只能補登昨天
    When 我在上方切換「今天／昨天」
    Then 只能編輯今天或昨天的打卡
    And 沒有更早日期的編輯入口
