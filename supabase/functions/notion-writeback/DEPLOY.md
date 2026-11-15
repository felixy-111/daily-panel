# notion-writeback 部署說明

## 這是什麼

在習慣面板（手機 PWA）上打勾時，這支小程式會「代替你」去 Notion 把同一個重複任務也打勾，兩邊才會一致。

比喻：PWA 是放在大街上的櫃台，Notion 鑰匙（token）不能放在櫃台上（任何人都看得到網頁原始碼）。這支 Edge Function（放在 Supabase 雲端、只有它拿得到鑰匙的小程式）就像後台的保險箱管理員：櫃台遞單子進來，它先確認「是你本人」，再拿鑰匙去 Notion 辦事。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.ts` | 主程式 |
| `lib.ts` | 純計算小工具（日期判斷、驗證輸入），有測試 |
| `lib_test.ts` | 測試，`deno test lib_test.ts` |
| `index.single.ts` | 把上面兩個合成一個檔，**給 Supabase 網頁編輯器貼上用**（自動產生，不要手改） |

## 部署步驟（Supabase 網頁後台，不用裝任何東西）

1. 打開 https://supabase.com/dashboard/project/ewynrebniwbptsnpnjyd/functions
2. 按「Deploy a new function」→ 選「Via Editor」（在網頁上直接寫）。
3. 函式名稱填：`notion-writeback`（一字不差，PWA 會用這個名字找它）。
4. 把編輯器裡預設的範例程式**全部刪掉**，貼上 `index.single.ts` 的全部內容。
   - 只貼這一個檔就好，不需要另外貼 `lib.ts`（已經合併在裡面了）。
5. 按「Deploy function」。
6. 設定 Notion 鑰匙：左側選單 Edge Functions → **Secrets**（或 Project Settings → Edge Functions）→ 新增
   - Name：`NOTION_TOKEN`
   - Value：Notion 整合 `habit-sync` 的 Internal Integration Secret（`ntn_` 開頭那串）
   - 存檔。`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 這三個 Supabase 會自動提供，**不用自己設**。
7. 回到 `notion-writeback` 的 **Details / Settings** 頁，確認「**Verify JWT**（驗證登入憑證）」是**開著**的。
   - 白話：開著代表沒登入的人連門都進不來；程式裡面還會再查一次「是不是名單上的主人」，等於兩道鎖。

## 部署後怎麼確認有成功

- 在 PWA 上把一個「連到 Notion 的習慣」打勾 → 約 5～20 秒內，Notion 那個重複任務應該跳到下一天，並多一筆完成紀錄頁；有填數值的話，數值會出現在那筆紀錄頁上。
- 再取消打勾 → 那筆紀錄頁會被丟到 Notion 垃圾桶（但任務的下次日期不會倒退回來，這是已知限制）。
- 出錯時：Supabase 後台 → Edge Functions → notion-writeback → **Logs** 可看錯誤訊息（只會有頁面 id 和狀態碼，不會有 token 或習慣名稱）。

## 會擋掉哪些請求（正常現象）

| 情況 | 回應 |
|---|---|
| 沒登入 / 登入過期 | 401 |
| 登入了但不是主人 | 403 |
| 習慣沒有對應的 Notion 頁、日期不是今天或昨天（凌晨 4 點換日） | 400 |
| Notion 太慢（20 秒內沒產生紀錄頁）或 Notion 出錯 | 502 |

## 改了程式之後

`index.ts` 或 `lib.ts` 有改，要重新產生合併檔，再到網頁編輯器整份貼上、重新 Deploy：

```bash
cd ~/projects/felix_agent/habits/dashboard/supabase/functions/notion-writeback
deno test lib_test.ts
{ echo "// GENERATED single-file bundle of index.ts + lib.ts for the Supabase dashboard editor."; \
  echo "// Regenerate after editing either file (see DEPLOY.md). Do not edit by hand."; \
  grep -v '^import { corsHeaders' index.ts; echo; echo "// ---- lib.ts ----"; cat lib.ts; } > index.single.ts
deno check index.single.ts
```

## 已知限制

- 補打昨天的勾：Notion 紀錄頁上的「完成時間」會是「現在」（今天），不是昨天。面板自己的紀錄日期是對的，收集程式也會跳過面板已經記過的紀錄頁，所以不會重複計算。
- 如果 Notion 超過 20 秒才產生紀錄頁，面板會收到 502；這時 Notion 那邊其實可能已經打勾了。再按一次可能會在 Notion 多出一筆紀錄頁（少見，手動刪掉即可）。
