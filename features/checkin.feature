# 一鍵打卡、數字輸入、離線
Feature: 一鍵打卡
  為了打卡不超過兩下
  身為面板主人
  我要點一下就完成或取消

  Background:
    Given 我已登入且在「今日」畫面

  Scenario: 點一下完成、再點一下取消
    When 我點 m1 格
    Then m1 顯示完成
    And habit_logs 有一筆 source=panel、done=true 的紀錄
    When 我再點一次 m1 格
    Then m1 顯示未完成
    And 同一筆 panel 紀錄改成 done=false，沒有被刪除

  Scenario: 數字型習慣輸入數值
    Given b2 的單位是 habit_defs 裡的「公里」
    When 我點 b2 格
    Then 格子下方出現數字輸入框（不是瀏覽器彈窗）
    When 我輸入 5 並按儲存
    Then b2 顯示完成、5 公里

  Scenario: 清空數值等於取消
    Given b3 今天面板已記 20 分鐘
    When 我點 b3 格，清空數字並儲存
    Then panel 紀錄 done=false

  Scenario: 已完成的數字格可取消打卡
    Given b1 今天已完成
    When 我點 b1 格
    Then 輸入框預填目前數值並出現「取消打卡」按鈕
    When 我按「取消打卡」
    Then panel 紀錄 done=false

  Scenario: m2 未達目標顯示半滿
    Given m2 的 target 是 108
    When 我輸入 54 並儲存
    Then m2 顯示「54/108」部分完成樣式

  Scenario: m2 改成 108 完成且只有一筆
    Given m2 今天面板已記 54
    When 我把數字改成 108 並儲存
    Then m2 顯示完成
    And 今天 m2 的 panel 紀錄只有一筆

  Scenario: 離線打卡
    Given 手機沒有網路
    When 我點 m1 格
    Then m1 立刻顯示完成，並標示「待同步」
    And 打卡先存進本機佇列
    When 網路恢復
    Then 佇列自動上傳 Supabase
    And 「待同步」標示消失

  Scenario: 兩台裝置離線衝突
    Given 手機與 Mac 都離線改了今天的 m1
    When 兩邊都上線同步
    Then 較晚寫入的那筆為準

  Scenario: 登出前有未同步資料先確認
    Given 本機還有沒送出的打卡、Notion 寫回或收件匣文字
    When 我按登出
    Then 頁面內出現確認（不是瀏覽器彈窗），寫明有幾筆會消失
    When 我選「先不登出」
    Then 留在面板，資料都還在
    When 我再按登出並選「仍要登出」
    Then 回到登入畫面，本機佇列清空

  Scenario: 沒有未同步資料直接登出
    Given 本機沒有待送資料
    When 我按登出
    Then 直接回到登入畫面，不出現確認

  Scenario: 長按格子開對應工具
    Given shadowing 在 habit_defs 設了 open_url
    When 我按住 shadowing 格 0.5 秒以上再放開
    Then 開啟 open_url 指向的工具
    And shadowing 的打卡狀態沒有改變

  Scenario: 長按不影響一般點擊
    When 我快速點一下 shadowing 格
    Then 照常打卡或取消，不會開啟工具

  Scenario: 沒設網址的格子長按沒反應
    Given email 的 open_url 是空的
    When 我按住 email 格 0.5 秒以上再放開
    Then 沒有開啟任何東西，打卡狀態也沒有改變

  Scenario: 只開安全的網址
    Given 某格的 open_url 不是 https:// 或白名單內的 App 連結
    When 我長按該格
    Then 沒有開啟任何東西

  Scenario: 資料庫還沒加 open_url 欄位
    Given habit_defs 還沒有 open_url 欄位
    When 我打開面板
    Then 九格照常顯示、點擊照常打卡
