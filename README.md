# NTAG424 Personalization API Server

This is a Node.js API server for personalizing and configuring NTAG424 NFC tags. The server provides a RESTful API for interacting with NFC tags via a connected reader.

## Requirements

- Node.js 18 (required for compatibility with the NFC libraries)
- NFC Reader (e.g., ACS ACR1252U)
- NTAG424 DNA tags

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Aadil1505/ntag-424-personalization.git
   cd ntag-424-personalization
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory:
   ```
   PORT=3000
   MASTER_KEY_HEX=YourHexEncodedMasterKey
   CL_READER=YourReaderName
   ```

4. Generate a secure master key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```
   Copy the output and add it to your `.env` file as `MASTER_KEY_HEX`

5. Start the server:
   ```bash
   node server.js
   ```

6. Access the web interface:
   - Open your browser and navigate to `http://localhost:3000`
   - Or use the API endpoints directly (see below)

## Complete End-to-End Workflow

**Want to personalize tags AND verify them?** See the complete workflow guide:

📖 **[COMPLETE_WORKFLOW.md](COMPLETE_WORKFLOW.md)** - Full tutorial showing:
- Setting up both personalization and verification servers
- Personalizing NTAG424 tags with SDM
- Verifying scanned tags with the SDM backend
- Production deployment checklist
- Security best practices

This guide walks through using this server with the [SDM Backend](https://github.com/nfc-developer/sdm-backend) for complete tag authentication.

## Configuration

The server requires the following environment variables:

- `PORT`: The port for the API server (default: 3000)
- `MASTER_KEY_HEX`: **REQUIRED** - A 32-character hex string (16 bytes) master key for key diversification
  - Generate with: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`
  - ⚠️ **Security Warning**: Never use all zeros or weak keys in production!
- `CL_READER`: The exact name of your NFC reader device
  - Example: `"ACS ACR1252 1S CL Reader(1)"`

You can enable debug logging by setting the `DEBUG` environment variable:
```
DEBUG=NTAG424:*
```

### Security Notes

- The server will **refuse to start** if `MASTER_KEY_HEX` is not set or invalid
- Using an all-zero master key will generate a warning (testing only!)
- Each tag derives unique keys from: `PBKDF2(masterKey + tagUID + keyNumber)`

## Web Interface

The server includes a modern web UI for easy tag management:

1. Start the server: `node server.js`
2. Open your browser to: `http://localhost:3000`

### Features:

- **Real-time Status Monitoring**: See NFC reader status, card presence, and key configuration
- **Read UID**: Quickly read tag unique identifiers
- **View Settings**: Inspect file access rights and SDM configuration
- **Personalize Tags**: Configure tags with custom URLs through an intuitive interface

![Web UI Preview](https://via.placeholder.com/800x400?text=NTAG424+Personalization+UI)

## API Endpoints

### Status

- `GET /status`: Get the status of the NFC reader

### Card Operations

- `GET /card/uid`: Get the UID of the card currently presented to the reader
- `GET /card/settings`: Get the current file settings of the card
- `POST /card/personalize`: Personalize a tag with a URL and secure settings (working example with SDM Backend, Master Key must be all 0)
  ```json
  {
    "url": "https://sdm.nfcdeveloper.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}"
  }
  ```

## URL Format

The server writes NDEF records with the following default URL format:

```
https://sdm.nfcdeveloper.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}
```

Where:
- `{uid}`: Will be replaced with the tag's unique identifier
- `{counter}`: Will be replaced with the tag's read counter
- `{cmac}`: Will be replaced with a cryptographic MAC for authentication

You can customize this URL by providing a different one in the request body.

## Example Usage

### Check Server Status

```bash
curl http://localhost:3000/status
```

### Get Card UID

```bash
curl http://localhost:3000/card/uid
```

### Get File Settings

```bash
curl http://localhost:3000/card/settings
```

### Personalize Tag

```bash
curl -X POST \
  http://localhost:3000/card/personalize \
  -H 'Content-Type: application/json' \
  -d '{}'
```

This will use the default URL format. You can also specify a custom URL if needed:

```bash
curl -X POST \
  http://localhost:3000/card/personalize \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://sdm.nfcdeveloper.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}"}'
```

## Security Features

The server implements several security features:

- **Key Diversification**: Each tag gets unique keys derived from master key + UID using PBKDF2-SHA512
- **AES-128-CBC Encryption**: All sensitive operations use AES-128 encryption
- **Session Keys**: Ephemeral keys generated for each authentication session (RndA/RndB exchange)
- **ISO/IEC 7816-4 Padding**: Proper cryptographic padding for all encrypted data
- **Request Locking**: Prevents concurrent NFC operations that could corrupt state
- **Master Key Validation**: Server won't start without a valid master key
- **Factory Key Replacement**: Automatically replaces insecure factory default keys

### Secure Dynamic Messaging (SDM)

Tags are configured with SDM to generate cryptographically signed URLs:
- `{uid}`: Tag unique identifier (injected by tag on scan)
- `{counter}`: Read counter (increments on each scan, prevents replay)
- `{cmac}`: AES-CMAC signature (proves authenticity)

The CMAC is generated using keys only the tag and your server know, making it impossible to forge valid URLs.

## Understanding File Settings

### Factory Default Settings

When you receive a fresh NTAG424 DNA tag, it has these default settings:

```json
{
  "fileType": 0,        // Standard Data File (NDEF container)
  "fileOption": 0,      // SDM is DISABLED (bit 0x40 not set)
  "fileSize": 256,      // 256 bytes available for NDEF data
  "accessRights": 61152,  // 0xEEE0 in hex
  "FileAR": {
    "Read": "e",        // 0xE = FREE (anyone can read NDEF)
    "Write": "e",       // 0xE = FREE (anyone can write NDEF)
    "ReadWrite": "e",   // 0xE = FREE (anyone can read/write)
    "Change": "0"       // 0x0 = Key 0 required to change settings
  },
  "SDMAR": {
    "SDMMetaRead": "0",   // Ignored (SDM disabled)
    "SDMFileRead": "0",   // Ignored (SDM disabled)
    "SDMCtrRet": "0"      // Ignored (SDM disabled)
  }
}
```

**Key Values Explained:**
- `0-4` = Specific key required (0=key0, 1=key1, 2=key2, etc.)
- `e` (0xE) = **FREE ACCESS** - no authentication needed
- `f` (0xF) = **DENIED** - operation not allowed

**Factory Keys:** All keys (0-4) are set to all zeros: `00000000000000000000000000000000`

### Settings After Personalization

After running the personalize endpoint, the tag configuration changes significantly:

```json
{
  "fileType": 0,
  "fileOption": 64,        // ✓ CHANGED! (0x40 = SDM enabled)
  "accessRights": 57344,   // ✓ CHANGED! (0xE000)
  "FileAR": {
    "Read": "e",           // ✓ Still FREE (anyone can scan)
    "Write": "0",          // ✓ LOCKED! (Key 0 required)
    "ReadWrite": "0",      // ✓ LOCKED! (Key 0 required)
    "Change": "0"          // ✓ LOCKED! (Key 0 required)
  },
  "fileSize": 256,
  "SDMOptions": 193,       // ✓ NEW! (0xC1 = UID + Counter + CMAC enabled)
  "SDMAccessRights": 57599,// ✓ NEW! (0xE0FF)
  "SDMAR": {
    "SDMMetaRead": "e",    // ✓ FREE (tag can generate SDM data)
    "SDMFileRead": "0",    // ✓ Key 0 for CMAC generation
    "SDMCtrRet": "f"       // ✓ Read counter retrieval denied
  },
  "UIDOffset": 38,         // ✓ NEW! Where UID is injected in URL*
  "SDMReadCtrOffset": 57,  // ✓ NEW! Where counter is injected*
  "SDMMACInputOffset": 69, // ✓ NEW! Where CMAC calculation starts*
  "SDMMACOffset": 69       // ✓ NEW! Where CMAC is injected*
}
```

**Note:** Offset values (38, 57, 69) depend on your URL structure and length. Different URLs will have different offsets, but the system calculates them automatically.

### Before vs After Comparison

| Aspect | **Factory Default** | **After Personalization** |
|--------|-------------------|--------------------------|
| **SDM Status** | ❌ Disabled | ✅ Enabled |
| **Read NDEF** | Anyone (free) | Anyone (free) |
| **Write NDEF** | Anyone (free) | 🔒 Key 0 only |
| **Change Settings** | 🔒 Key 0 only | 🔒 Key 0 only |
| **Keys 0-4** | All zeros (factory) | 🔑 Unique derived keys (PBKDF2) |
| **URL Type** | Static | 🔄 Dynamic (SDM-enabled) |
| **Security** | ⚠️ None | ✅ Cryptographically signed |

### Key Derivation

**Before Personalization:**
```
All keys: 00000000000000000000000000000000 (factory default)
```

**After Personalization:**
```
Tag UID: 04E5F2A1234567 (example)

Derived Keys (unique per tag):
Key 0: PBKDF2(masterKey + UID + 0) = a3b7c2d4e5f6...
Key 1: PBKDF2(masterKey + UID + 1) = f1e2d3c4b5a6...
Key 2: PBKDF2(masterKey + UID + 2) = 1a2b3c4d5e6f...
Key 3: PBKDF2(masterKey + UID + 3) = 7g8h9i0j1k2l...
Key 4: PBKDF2(masterKey + UID + 4) = m3n4o5p6q7r8...
```

Each tag gets **different keys** based on its unique UID!

### How SDM Changes Tag Behavior

**Before Personalization (Empty):**
```
Scan Result: None
(Empty tag - no security)
```

**After Personalization (Dynamic & Secure):**
```
First Scan:  https://sdm.nfcdeveloper.com/tagpt?uid=04E5F2A1234567&ctr=000001&cmac=A3B2C1D4E5F6...
Second Scan: https://sdm.nfcdeveloper.com/tagpt?uid=04E5F2A1234567&ctr=000002&cmac=D7C5B8A9F3E1...
Third Scan:  https://sdm.nfcdeveloper.com/tagpt?uid=04E5F2A1234567&ctr=000003&cmac=F8D6C4B2A1E0...
                                                 ^^^^^^^^^^^^^^      ^^^^^^      ^^^^^^^^^^^^^^^^
                                                 Tag UID (unique)    Counter     CMAC (changes each scan)
```

**What the tag automatically injects:**
- **UID**: Tag's unique identifier (never changes)
- **Counter**: Increments with each scan (prevents replay attacks)
- **CMAC**: Cryptographic signature using secret Key 0 (proves authenticity)

**Why this matters:**
- ✅ Each scan produces a unique URL
- ✅ Server can verify the CMAC to confirm tag is genuine
- ✅ Counter prevents someone from reusing old URLs
- ✅ Impossible to forge without knowing the secret keys

### Repersonalization & Master Key Security

#### Can I update a tag after it's been personalized?

**Yes, but only if you have the original master key!**

Tags can be repersonalized (update URL, change settings) **only** with the same `MASTER_KEY_HEX` used originally.

#### What happens if I try a different master key?

```
Error: error in set up RndA
```

**This is intentional security!** If anyone could reprogram your tags with different keys:
- ❌ Stolen tags could be repurposed
- ❌ Your verification system would break
- ❌ Tags could be cloned/counterfeited

#### How does repersonalization work?

```
1. Tag was personalized with: MASTER_KEY_HEX=abc123...
2. Tag UID: 04E5F2A1234567
3. Keys on tag: PBKDF2(abc123... + 04E5F2A1234567 + 0-4)

To repersonalize:
1. Use the SAME master key: MASTER_KEY_HEX=abc123...
2. System derives SAME keys: PBKDF2(abc123... + 04E5F2A1234567 + 0-4)
3. ✓ Authentication succeeds (keys match!)
4. ✓ Can update URL/settings
```

#### What if I lose my master key?

**Critical:** Back up your `MASTER_KEY_HEX` securely!

If lost:
- ✅ Tags still work for scanning (SDM generates URLs)
- ❌ **Cannot repersonalize** (permanently locked)
- ❌ **Cannot change URL or settings**

**Master key = master password for ALL your tags**

## Recent Bug Fixes

All critical security and functional bugs have been fixed:

✅ Fixed undefined variable crashes in `generateFileSettings()`
✅ Fixed incorrect cryptographic padding in encrypt/decrypt
✅ Fixed authenticate() using string instead of numeric key number
✅ Fixed broken re-authentication after key changes
✅ **Fixed critical master key validation bug (GitHub Issue #1)**
✅ Replaced outdated `var` with `let`/`const`
✅ Added request locking for concurrent access protection

All changes have been tested and verified.

## License

This project is licensed under the CC0 1.0 Universal License - see the LICENSE file for details.