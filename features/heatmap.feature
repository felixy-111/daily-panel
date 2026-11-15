# 歷史畫面
Feature: 熱力圖
  為了看出近期的節奏
  身為面板主人
  我要在「歷史」畫面看近 12 週

  Background:
    Given 我已登入並切到「歷史」

  Scenario: 近 12 週、每個習慣一列
    Then 每個習慣一列，每列涵蓋近 12 週（週一到週日）

  Scenario: 四種狀態的顏色
    Then 完成顯示深色
    And 部分完成顯示淺色
    And 未知顯示斜線
    And 未做顯示空白

  Scenario: 兩個來源同一天只算一格
    Given 同一天 b3 有 panel 與 notion 兩筆完成紀錄
    Then 熱力圖當天 b3 是一格完成

  Scenario: 歷史畫面只有熱力圖
    Then 歷史畫面除了熱力圖沒有其他圖表

  @later
  Scenario: 趨勢圖（後續，MVP 不做）
    Then 近 8 週每週完成項次的折線圖
