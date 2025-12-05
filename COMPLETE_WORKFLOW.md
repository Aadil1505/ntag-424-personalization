# Complete Workflow: Tag Personalization + Verification

This guide shows you how to use the **personalization server** (this repo) together with the **SDM backend** for complete tag verification. You'll personalize NFC tags and verify their authenticity when scanned.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Complete System                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Personalization Server (Node.js - Port 3000)            │
│     - Writes unique keys to each tag                        │
│     - Configures SDM (Secure Dynamic Messaging)             │
│     - Sets up NDEF URL with placeholders                    │
│                                                              │
│  2. Tag (NTAG424 DNA)                                       │
│     - Stores unique derived keys                            │
│     - Generates dynamic URLs with UID, Counter, CMAC        │
│                                                              │
│  3. SDM Backend (Python Flask - Port 5000)                  │
│     - Receives scanned tag URLs                             │
│     - Verifies CMAC signature                               │
│     - Confirms tag authenticity                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- ✅ NTAG424 DNA tags (factory fresh)
- ✅ NFC reader (e.g., ACS ACR1252U)
- ✅ NFC-capable smartphone for testing
- ✅ Node.js 18+ installed
- ✅ Python 3.7+ installed
- ✅ Git installed

## Part 1: Setup Personalization Server

### Step 1: Install This Repo

```bash
cd ~/Projects  # or your preferred directory
git clone https://github.com/Aadil1505/ntag-424-personalization.git
cd ntag-424-personalization
npm install
```

### Step 2: Generate Master Key

**CRITICAL:** Generate a secure master key that will be used by BOTH servers.

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

**Save this output!** Example:
```
a1b2c3d4e5f6789012345678abcdef01
```

### Step 3: Configure Environment

Create `.env` file:

```bash
cat > .env << 'EOF'
PORT=3000
MASTER_KEY_HEX=a1b2c3d4e5f6789012345678abcdef01
CL_READER="ACS ACR1252 1S CL Reader(1)"
EOF
```

**Important:** Replace with:
- Your generated master key
- Your exact NFC reader name

### Step 4: Start Personalization Server

```bash
node server.js
```

You should see:
```
NFC API server running on port 3000
```

**Keep this terminal open!**

---

## Part 2: Setup SDM Backend

Open a **new terminal window**.

### Step 1: Clone SDM Backend

```bash
cd ~/Projects
git clone https://github.com/nfc-developer/sdm-backend.git
cd sdm-backend
```

### Step 2: Setup Python Environment

```bash
# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate  # On macOS/Linux
# OR
.\venv\Scripts\activate   # On Windows
```

### Step 3: Install Dependencies

```bash
pip3 install -r requirements.txt
```

### Step 4: Configure SDM Backend

Copy the config file:
```bash
cp config.dist.py config.py
```

**CRITICAL:** Edit `config.py` and set the **SAME master key**:

```python
# config.py
MASTER_KEY = 'a1b2c3d4e5f6789012345678abcdef01'  # MUST match .env!
```

### Step 5: Start SDM Backend

```bash
python3 app.py --host 0.0.0.0 --port 5000
```

You should see:
```
 * Running on http://0.0.0.0:5000
```

**Keep this terminal open too!**

---

## Part 3: Verify Both Servers Running

Open a **third terminal window** and check:

```bash
# Check personalization server
curl http://localhost:3000/status

# Check SDM backend
curl http://localhost:5000
```

Both should respond without errors.

---

## Part 4: Personalize Your First Tag

### Step 1: Place Tag on Reader

Put a fresh NTAG424 tag on your NFC reader.

### Step 2: Open Personalization UI

Open browser to: **http://localhost:3000**

### Step 3: Check Status

The status bar should show:
- ✅ Reader: Ready (green)
- ✅ Master Key: Configured (green)

### Step 4: Configure URL for SDM Backend

In the "Personalize Tag" section, update the URL to point to your local backend:

```
http://localhost:5000/tagpt?uid={uid}&ctr={counter}&cmac={cmac}
```

**Important:** This URL must include all three placeholders:
- `{uid}` - Tag unique ID
- `{counter}` - Read counter
- `{cmac}` - Cryptographic signature

### Step 5: Personalize the Tag

Click **"Personalize Tag"**

You should see:
```
✓ Success!
UID: 04E5F2A1234567
Status: Tag personalized with new keys and settings
Factory Tag: Yes

[Keys Changed] [SDM Enabled]
```

**What just happened:**
- ✅ Tag's factory keys replaced with unique derived keys
- ✅ SDM enabled on the tag
- ✅ URL template written to tag
- ✅ Tag locked (only your master key can modify it)

---

## Part 5: Test Tag Verification

### Method 1: Using Browser (Desktop)

The personalized tag's URL points to `localhost:5000`, which won't work when scanning with a phone. Let's test locally first.

1. Read the tag's current NDEF in the UI
2. The tag should show something like:
   ```
   http://localhost:5000/tagpt?uid=04E5F2A1234567&ctr=000001&cmac=A3B2C1D4E5F6...
   ```

3. Open that URL in your browser

4. The SDM backend should verify the tag and show:
   ```json
   {
     "verified": true,
     "uid": "04E5F2A1234567",
     "counter": 1,
     "message": "Tag authentic!"
   }
   ```

### Method 2: Using Smartphone (Production)

For real-world use, you need the backend accessible from the internet.

**Option A: Use ngrok (Quick Testing)**

```bash
# In a new terminal
ngrok http 5000
```

You'll get a public URL like: `https://abc123.ngrok.io`

Re-personalize your tag with this URL:
```
https://abc123.ngrok.io/tagpt?uid={uid}&ctr={counter}&cmac={cmac}
```

Now scan the tag with your phone - it will verify through the public endpoint!

**Option B: Deploy to Production**

Deploy both services to a real server:
- Personalization server (for internal use only)
- SDM backend (public-facing, e.g., https://verify.yourcompany.com)

---

## Part 6: Understanding Verification

### What Happens During Scan

```
1. Phone scans tag
   ↓
2. Tag generates URL:
   https://verify.yourcompany.com/tagpt?uid=04E5F2A1234567&ctr=000002&cmac=D7C5B8...
   ↓
3. Phone opens URL in browser
   ↓
4. SDM Backend receives request
   ↓
5. Backend extracts: uid, counter, cmac
   ↓
6. Backend derives tag's keys: PBKDF2(masterKey + uid + keyNo)
   ↓
7. Backend recalculates CMAC using derived keys
   ↓
8. Backend compares:
   - Received CMAC: D7C5B8...
   - Calculated CMAC: D7C5B8...
   ↓
9. ✓ Match? Tag is AUTHENTIC!
   ✗ No match? Tag is FAKE or TAMPERED!
```

### Why This Is Secure

✅ **Each tag has unique keys** (derived from master key + UID)
✅ **CMAC changes every scan** (includes counter)
✅ **Impossible to forge** (attacker doesn't know master key)
✅ **Replay attacks prevented** (counter increments)
✅ **No database needed** (keys derived on-demand)

---

## Part 7: Batch Processing Multiple Tags

### Using the Web UI

1. Place tag 1 on reader
2. Click "Personalize Tag"
3. Wait for success
4. Remove tag 1
5. Place tag 2 on reader
6. Click "Personalize Tag"
7. Repeat...

### Using API (Automation)

```bash
# Personalize current tag on reader
curl -X POST http://localhost:3000/card/personalize \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://verify.yourcompany.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}"
  }'

# Wait for response, then swap tags and repeat
```

---

## Troubleshooting

### "Master key not configured" Error

**Cause:** SDM backend doesn't have master key set

**Fix:**
```bash
# Edit config.py
MASTER_KEY = 'a1b2c3d4e5f6789012345678abcdef01'

# Restart SDM backend
python3 app.py --host 0.0.0.0 --port 5000
```

### "Verification failed" When Scanning

**Cause:** Master keys don't match between servers

**Fix:**
1. Check personalization server `.env`:
   ```
   MASTER_KEY_HEX=a1b2c3d4e5f6789012345678abcdef01
   ```

2. Check SDM backend `config.py`:
   ```python
   MASTER_KEY = 'a1b2c3d4e5f6789012345678abcdef01'
   ```

3. **They must be identical!**

### Tag Shows "Static URL" When Scanned

**Cause:** SDM not enabled properly

**Fix:**
1. Check file settings show `SDMOptions: 193`
2. Verify `fileOption: 64` (SDM enabled)
3. Try repersonalizing the tag

### "localhost:5000" Not Accessible from Phone

**Expected!** Your phone can't reach localhost.

**Solutions:**
- Use ngrok for testing: `ngrok http 5000`
- Deploy to real server for production
- Use your computer's local IP (e.g., `192.168.1.100:5000`) if on same WiFi

---