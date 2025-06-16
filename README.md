# NTAG424 Personalization API Server

This is a Node.js API server for personalizing and configuring NTAG424 NFC tags. The server provides a RESTful API for interacting with NFC tags via a connected reader.

## Requirements

- Node.js 18 (required for compatibility with the NFC libraries)
- NFC Reader (e.g., ACS ACR122U)
- NTAG424 DNA tags

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Aadil1505/Authlink-NFC-Node-Backend
   cd authlink-nfc-node-backend
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

4. Start the server:
   ```bash
   node server.js
   ```

## Configuration

The server requires the following environment variables:

- `PORT`: The port for the API server (default: 3000)
- `MASTER_KEY_HEX`: Master key in hexadecimal format for key diversification
- `CL_READER`: The exact name of your NFC reader device

You can enable debug logging by setting the `DEBUG` environment variable:
```
DEBUG=NTAG424:*
```

## API Endpoints

### Status

- `GET /status`: Get the status of the NFC reader

### Card Operations

- `GET /card/uid`: Get the UID of the card currently presented to the reader
- `GET /card/ndef`: Read NDEF data from the card
- `POST /card/ndef`: Write NDEF data to the card
  ```json
  {
    "url": "http://10.25.130.96:3000/verification?uid={uid}&ctr={counter}&cmac={cmac}"
  }
  ```
- `GET /card/settings`: Get the current file settings of the card
- `POST /card/personalize`: Personalize a tag with a URL and secure settings (working example with SDM Backend)
  ```json
  {
    "url": "https://sdm.nfcdeveloper.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}"
  }
  ```

## URL Format

The server writes NDEF records with the following default URL format:

```
http://10.25.130.96:3000/verification?uid={uid}&ctr={counter}&cmac={cmac}
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
  http://localhost:3002/card/personalize \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://sdm.nfcdeveloper.com/tagpt?uid={uid}&ctr={counter}&cmac={cmac}"}'
```

## Security Features

The server implements several security features:

- Key diversification based on UID and master key
- AES-128 encryption for secure communication
- Session key generation for each authentication
- Secure file settings configuration

## License

This project is licensed under the CC0 1.0 Universal License - see the LICENSE file for details.