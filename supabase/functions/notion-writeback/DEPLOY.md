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
  sed '/^import {$/,/^} from "\.\/lib\.ts";$/d' index.ts; echo; echo "// ---- lib.ts ----"; cat lib.ts; } > index.single.ts
deno check index.single.ts
```

## 已知限制

- **補打昨天的勾（Notion 那邊沒有昨天的紀錄頁時）：不會動 Notion**，只記在面板。原因：這時候叫 Notion 打勾，紀錄頁的完成時間會是「今天」，還會把下次日期再往後推一天，等於把今天的進度弄亂。回應會是 `{ok:true, skipped:"backfill"}`，面板不會顯示「Notion 未同步」。
  - 如果 Notion 裡**已經有**昨天的紀錄頁（例如昨天在 Notion 勾過），面板會直接認領那一頁（把數值寫上去），不會再產生新的。
- **防重複**：打勾前會先看這個任務最近 5 筆紀錄頁，只要已經有一筆的完成時間落在同一天（凌晨 4 點換日），就直接認領那一頁，不會再叫 Notion 打勾一次。所以「先在 Notion 勾、再到面板填數字」或「上次逾時、再按一次」都不會多出紀錄頁。
  - 假設：Notion 把新的紀錄頁接在 Occurrences 清單最後面（跟偵測新紀錄頁用的是同一個假設）。若實際順序相反，防重複會失效，要回報。
- 如果原任務目前狀態已經是 Done（Notion 自動化還沒把它重設），不會再設一次 Done，只會等新的紀錄頁出現。若自動化根本沒在跑，會一直 502（面板顯示「Notion 未同步」）。
- 如果 Notion 超過 20 秒才產生紀錄頁，面板會收到 502；面板稍後重試時會認領那張晚到的紀錄頁，不會再多一張。
- 取消打勾只會把「面板這次自己叫 Notion 產生」的那張紀錄頁丟進垃圾桶；任務的下次日期不會倒退。
  - **認領來的紀錄頁不會被記住**：不論是你在 Notion 勾的，還是面板上次逾時、這次才認領到的晚到紀錄頁，都一律當成「在 Notion 勾過」處理（回應帶 `adopted:true`）。在面板取消打勾**不會**刪掉它，格子會維持完成並顯示「Notion 已勾選」；要取消請到 Notion 把那筆取消勾選／刪掉。原因：分不出那張是不是你親手在 Notion 勾的，寧可不刪。
- 這支程式只會更新面板那一列的 `source_ref`（記住對應哪張 Notion 紀錄頁），不會改打勾狀態或數值——那些由手機端決定，避免慢回應蓋掉你後來的取消。
- 資料庫裡的 `source_ref` 只有在「格式是 Notion 頁面 id」而且「確實是這個任務自己的紀錄頁」時才會被使用，其他一律當作沒有。

---

# inbox-capture 部署說明（收件匣投信口）

## 這是什麼

面板上方的「＋收件匣」打一行字按 Enter，這支小程式會「代替你」在 Notion 的 Tasks 資料庫新增一頁（只填標題），它就會出現在 Ultimate Brain 的收件匣（Inbox）。

比喻：面板是「投信口」，不是「信箱」。信一投進去就到 Notion 了，面板自己不留底、不列清單。跟 `notion-writeback` 一樣，Notion 鑰匙只放在 Supabase 雲端，這支小程式先確認「是你本人」才會去 Notion 辦事。

程式放在 `supabase/functions/inbox-capture/`，檔案分工跟上面那支一樣（`index.ts` 主程式、`lib.ts` 小工具、`lib_test.ts` 測試、`index.single.ts` 給網頁編輯器貼上用）。

## 部署步驟（Supabase 網頁後台，不用裝任何東西）

1. 打開 https://supabase.com/dashboard/project/ewynrebniwbptsnpnjyd/functions
2. 按「Deploy a new function」→ 選「Via Editor」。
3. 函式名稱填：`inbox-capture`（一字不差，面板會用這個名字找它）。
4. 把編輯器裡預設的範例程式**全部刪掉**，貼上 `supabase/functions/inbox-capture/index.single.ts` 的全部內容。
5. 按「Deploy function」。
6. Notion 鑰匙：左側 Edge Functions → **Secrets**，確認清單裡已經有 `NOTION_TOKEN`。
   - 這把鑰匙是整個專案共用的，部署 `notion-writeback` 時已經設過，**有看到就不用再設**；沒看到才照上面第 6 步新增一次。
   - 不需要其他設定。（進階：想改丟到別的資料庫，才新增 `NOTION_INBOX_DATA_SOURCE_ID`；不設就是 Tasks。）
7. 回到 `inbox-capture` 的 **Details / Settings** 頁，確認「**Verify JWT**」是**開著**的。

## 部署後怎麼確認有成功

1. 打開面板 →「今日」→ 右上角「＋收件匣」→ 打 `測試投信` → Enter。
2. 應該看到「已送到收件匣」。若顯示「還沒送出…」而且按鈕變成「待送 1」，代表小程式還沒部署好或 Notion 出錯（字不會不見，修好後會自動補送）。
3. 打開 Notion → Ultimate Brain 的收件匣（Inbox），應該看到一筆 `測試投信`。**這一步請親眼確認一次**：程式查過這筆的狀態會被模板算成 Inbox，但收件匣畫面本身的篩選條件程式讀不到。
4. 確認完把那筆測試刪掉即可。

## 會擋掉哪些請求（正常現象）

| 情況 | 回應 |
|---|---|
| 沒登入 / 登入過期 | 401 |
| 登入了但不是主人 | 403 |
| 空白、超過 500 字、格式不對 | 400 |
| Notion 出錯或連不上 | 502（面板會把字留著，之後自動補送） |

## 隱私

- 雲端紀錄（Logs）只會有狀態碼，例如 `inbox-capture: notion -> 401`，**不會有你打的字，也不會有 token**。
- 你打的字只會存在兩個地方：送出前暫存在你手機的瀏覽器裡（待送佇列），以及送出後的 Notion。Supabase 資料庫不存。
- 登出時若還有沒送出的字，面板會先警告，確認後才清掉。

## 已知限制

- **偶爾會重複**：如果 Notion 其實已經建好頁面、但回應太慢（超過 10 秒），面板會以為沒成功而再送一次，收件匣會多一筆一樣的。接受，手動刪掉即可。
- 沒送出的字只存在「打字的那台裝置」，換一台裝置看不到「待送」。
- 面板不會顯示丟過的內容，要看請到 Notion 收件匣。

## 改了程式之後

`inbox-capture/index.ts` 或 `lib.ts` 有改，要重新產生合併檔，再到網頁編輯器整份貼上、重新 Deploy：

```bash
cd ~/projects/felix_agent/habits/dashboard/supabase/functions/inbox-capture
deno test lib_test.ts
{ echo "// GENERATED single-file bundle of index.ts + lib.ts for the Supabase dashboard editor."; \
  echo "// Regenerate after editing either file (see DEPLOY.md). Do not edit by hand."; \
  sed '/^import {$/,/^} from "\.\/lib\.ts";$/d' index.ts; echo; echo "// ---- lib.ts ----"; cat lib.ts; } > index.single.ts
deno check index.single.ts
```

