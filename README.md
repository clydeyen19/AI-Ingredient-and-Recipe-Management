# 食材飲食管理

Local-first 食材庫存與飲食紀錄 Web App。前端使用 React + Vite，後端使用 FastAPI + SQLite。OpenAI API 只由後端呼叫，前端不保存 API key。

## 快速啟動

### 最簡單方式

在 Finder 雙擊：

```text
打開食材飲食管理.command
```

或在 Terminal 執行：

```bash
./start_app.sh
```

啟動後打開：`http://127.0.0.1:5173/`

### 1. 後端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env
python app.py
```

後端預設：`http://127.0.0.1:8000`

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

前端預設：`http://127.0.0.1:5173`

## OpenAI 設定

在專案根目錄建立 `.env`：

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

沒有 API key 時，手動庫存與三餐紀錄仍可使用；AI 分析與週菜單會回傳清楚錯誤。

## 功能

- 食材庫存：種類、剩餘量、有效期限、是否開封、距離過期天數。
- 三餐紀錄：早中晚餐、照片、描述、AI 建議。
- 食材用量：確認 AI 建議後才扣庫存。
- 總覽：庫存摘要、快過期、已開封、低庫存。
- AI：食材/餐點照片分析、文字食材解析、週飲食推薦。
