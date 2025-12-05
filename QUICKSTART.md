# Quick Start Guide

Get up and running with NTAG424 tag personalization in 5 minutes!

## Prerequisites

- ✅ Node.js 18+ installed
- ✅ NFC Reader connected (e.g., ACS ACR1252U)
- ✅ NTAG424 DNA tags

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Find Your Reader Name

Your reader name must match exactly. Run this to find it:

```bash
# On macOS/Linux
ls /dev/*usb* 2>/dev/null

# Or check system report
system_profiler SPUSBDataType | grep -A 10 "ACR"
```

Common reader names:
- `"ACS ACR1252 1S CL Reader(1)"`
- `"ACS ACR122U PICC Interface"`

## Step 3: Generate Master Key

**IMPORTANT**: Never use the default all-zero key in production!

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Copy the output (e.g., `a1b2c3d4e5f6789012345678abcdef01`)

## Step 4: Create .env File

Create a file named `.env` in the project root:

```env
PORT=3000
MASTER_KEY_HEX=a1b2c3d4e5f6789012345678abcdef01  # Use your generated key!
CL_READER="ACS ACR1252 1S CL Reader(1)"           # Use your exact reader name!

# Optional: Enable debug logging
# DEBUG=NTAG424:*
```

## Step 5: Start the Server

```bash
node server.js
```

You should see:
```
NFC API server running on port 3000
```

✅ If you see "WARNING: Master key is all zeros" - generate a new key!
✅ If you see "CRITICAL ERROR: MASTER_KEY_HEX" - check your .env file

## Step 6: Open Web Interface

1. Open your browser
2. Navigate to: **http://localhost:3000**
3. You should see the NTAG424 Personalization web interface

## Step 7: Personalize Your First Tag

1. **Check Status**: The status bar should show:
   - NFC Reader: ✅ Ready (green)
   - Master Key: ✅ Secure (green)

2. **Place Tag on Reader**: The "Card Status" should change to indicate presence

3. **Read UID**: Click "Read UID" to verify the tag is detected
   - You should see the tag's unique identifier (e.g., `04E5F2A1234567`)

4. **Personalize Tag**:
   - Review the default URL template (or customize it)
   - Click "Personalize Tag"
   - Wait for success message

5. **Done!** Your tag is now configured with:
   - ✅ Unique derived keys (based on UID + master key)
   - ✅ Secure Dynamic Messaging (SDM) enabled
   - ✅ Custom URL with authentication

## Testing Your Tag

Scan the tag with any NFC-capable phone. It should open a URL like:

```
https://sdm.nfcdeveloper.com/tagpt?uid=04E5F2A1234567&ctr=000001&cmac=A3B2C1D4E5F6...
```

Where:
- `uid`: Your tag's unique ID
- `ctr`: Read counter (increments each scan)
- `cmac`: Cryptographic signature (proves authenticity)

## Troubleshooting

### "NFC reader not ready"
- Check USB connection
- Verify CL_READER name matches exactly
- Try unplugging and reconnecting reader
- Check permissions (may need sudo on Linux)

### "No card detected"
- Ensure tag is placed flat on reader
- Remove any metal objects between tag and reader
- Try different tag position

### "Master key not configured"
- Check .env file exists in project root
- Verify MASTER_KEY_HEX is 32 hex characters (16 bytes)
- Restart server after changing .env

### Server won't start
- Check Node.js version: `node --version` (need 18+)
- Verify all dependencies installed: `npm install`
- Check port 3000 isn't in use: `lsof -i :3000`

## Next Steps

- **Batch Processing**: Personalize multiple tags by repeating step 7
- **Custom URLs**: Modify the URL template for your backend
- **Verify CMACs**: Implement backend verification using the master key
- **Production**: Generate a secure master key and keep it safe!

## Security Reminders

🔒 **Never commit your .env file to git!**
🔒 **Keep your master key secret and backed up!**
🔒 **Use a cryptographically secure master key in production!**
🔒 **Each tag gets unique keys - losing the master key means you can't derive them!**

## Getting Help

- Check the main [README.md](README.md) for detailed documentation
- Review [GitHub Issues](https://github.com/Aadil1505/ntag-424-personalization/issues)
- API documentation available in README

---

**Happy Tag Personalizing! 🎉**
