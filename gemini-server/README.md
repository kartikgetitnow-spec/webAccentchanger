# Gemini Voice Token Server (FastAPI)

A secure, high-performance Python FastAPI backend for real-time voice transformation and ephemeral token generation with the Google Gemini Multimodal Live API.

---

## 1. What This Server Does

- **Generates Ephemeral Tokens (`POST /api/token`)**: Issues short-lived, rate-limited tokens for direct client-to-Gemini Live API WebSocket connections.
- **Isolates Secret Credentials**: Safeguards your permanent `GEMINI_API_KEY` on the server so frontend clients never see or bundle it.
- **WebSocket Voice Transformation Bridge (`/ws/gemini`)**: An optional bidirectional audio proxy bridging client PCM audio (16kHz mono) to Gemini Live and streaming back converted AI voice chunks (24kHz mono) for personas like Puck, Charon, Kore, Fenrir, and Aoede.
- **Health & Readiness Endpoints (`GET /health`, `GET /api/token/health`)**: Reports server uptime, model readiness, and API key presence without leaking credentials.

---

## 2. Prerequisites

- **Python**: 3.11 or higher
- **Google Gemini API Key**: Acquired from [Google AI Studio](https://aistudio.google.com/)
- **pip** package manager

---

## 3. Local Setup & Running

### Step 1: Create and Activate Virtual Environment
```bash
cd gemini-server
python3 -m venv venv

# macOS / Linux
source venv/bin/activate

# Windows (Command Prompt)
venv\Scripts\activate.bat

# Windows (PowerShell)
venv\Scripts\Activate.ps1
```

### Step 2: Install Python Dependencies
```bash
pip install -r requirements.txt
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env` and configure your API key:
```bash
cp .env.example .env
```
Edit `.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,https://web-accentchanger.vercel.app
PORT=8000
TOKEN_TTL_SECONDS=1800
GEMINI_MODEL=gemini-2.0-flash-live-001
GEMINI_VOICE=Puck
```

### Step 4: Run the Development Server
```bash
uvicorn app.main:app --reload --port 8000
```
- Interactive Swagger UI documentation: `http://localhost:8000/docs`
- Redoc API documentation: `http://localhost:8000/redoc`

---

## 4. API Endpoints

### `POST /api/token` (or `POST /token`)
Issues a short-lived ephemeral token for client authentication.
- **Headers**: `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "user_id": "kartik123",
    "room_id": "room-abc123",
    "voice": "Puck"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "token": "authTokens/abcdef123456...",
    "expires_at": 1726001800,
    "model": "gemini-2.0-flash-live-001",
    "voice": "Puck",
    "ws_url": "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=authTokens/abcdef123456..."
  }
  ```
- **Rate Limit**: Maximum 10 requests per minute per `user_id`. Returns `429 Too Many Requests` on violation.

### `GET /api/token/health`
Confirms whether the token service is ready and `GEMINI_API_KEY` is loaded.
- **Response**:
  ```json
  {
    "status": "ok",
    "gemini_configured": true
  }
  ```

### `GET /health`
System liveness probe returning API version, server timestamp, and key configuration status.
- **Response**:
  ```json
  {
    "status": "ok",
    "version": "1.0.0",
    "timestamp": "2026-09-10T18:00:00.000000+00:00",
    "gemini_api_key_loaded": true
  }
  ```

### `WS /ws/gemini`
Bidirectional WebSocket audio stream connecting client PCM audio to Gemini Live API.
- **First Handshake Frame (JSON)**:
  ```json
  {
    "token": "authTokens/...",
    "voice": "Puck",
    "system_prompt": "You are a voice accent transformer."
  }
  ```
- **Subsequent Frames**: Binary Int16 16kHz mono audio chunks $\leftrightarrow$ Int16 24kHz mono audio output.

---

## 5. Deployment Options

### Option A: Railway
1. Install Railway CLI: `npm i -g @railway/cli`
2. Authenticate: `railway login`
3. Initialize project inside `gemini-server`:
   ```bash
   cd gemini-server
   railway init
   railway up
   ```
4. In the Railway project dashboard, add the environment variable `GEMINI_API_KEY`.

### Option B: Render
1. Create a new **Web Service** on Render connected to this repository.
2. Set **Root Directory** to `gemini-server`.
3. Set **Runtime** to `Python 3` or `Docker`.
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. Set **Environment Variables**:
   - `GEMINI_API_KEY = your_key`
   - `ALLOWED_ORIGINS = https://your-frontend.vercel.app`

### Option C: Google Cloud Run
Build and deploy the container directly using Google Cloud SDK:
```bash
cd gemini-server
gcloud builds submit --tag gcr.io/PROJECT_ID/gemini-server
gcloud run deploy gemini-server \
  --image gcr.io/PROJECT_ID/gemini-server \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY="your_api_key"
```

---

## 6. Security Architecture

- **Never Expose `GEMINI_API_KEY` to the Frontend**: The secret key must reside solely in `gemini-server/.env` or server environment variables.
- **Ephemeral Scoping**: Tokens generated by `POST /api/token` are strictly time-limited (`TOKEN_TTL_SECONDS`, default 30 min) and single-use/session-bound.
- **In-Memory Rate Limiting**: The server enforces a sliding window rate limit per `user_id` to mitigate DDoS and token exhaustion.
- **CORS Protection**: Restricted to trusted origins defined in `ALLOWED_ORIGINS`.
