require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const NDEF = require('ndef');
const { NFC } = require('nfc-pcsc');
const { crcjam } = require('crc');

// Import crypto functions
const {
  calcSessionKeys,
  decrypt,
  encrypt,
  MAC,
  MACt,
  rotateLeft,
  rotateRight,
  AES128KeyDiversification,
} = require('./crypto');

// Create Express app
const app = express();
app.use(bodyParser.json());

// Configuration
const PORT = process.env.PORT || 3000;
const { MASTER_KEY_HEX, CL_READER } = process.env;
let masterKey = Buffer.from(MASTER_KEY_HEX || '', 'hex');

// Format UID to uppercase
function formatUid(uid) {
  if (Buffer.isBuffer(uid)) {
    return uid.toString('hex').toUpperCase();
  } else if (typeof uid === 'string') {
    return uid.toUpperCase();
  }
  return '';
}

// Constants
const HEX = 0x10;
const ndefAid = Buffer.from("D2760000850101", "hex");
const ndefFileId = Buffer.from("e104", "hex");
const system_id = Buffer.from('accessgranted');

const uidAsciiLength = 14;
const cmacAsciiLength = 16;
const counterAsciiLength = 6;

const NOT_FOUND = -1;

const success = Buffer.from("9000", "hex");
const ok = Buffer.from("9100", "hex");

const CMAC_START_TAG = "{cmacStart}";
const CMAC_TAG = "{cmac}";
const UID_TAG = "{uid}";
const COUNTER_TAG = "{counter}";

const CommMode = {
  PLAIN: 0,
  MAC: 1,
  FULL: 0x3,
};

const factoryKey = Buffer.alloc(0x10).fill(0x0);

// Set up debug logging
const debug = require('debug');
const log = {
  send: debug("NTAG424:send"),
  recv: debug("NTAG424:recv"),
  ndef: debug("NTAG424:ndef"),
  settings: debug("NTAG424:settings"),
  keys: debug("NTAG424:keys"),
  api: debug("NTAG424:api"),
};

// NFC reader state
let nfcReader = null;
let isReaderReady = false;
let lastError = null;
let lastScanResult = null;
let currentCard = null;

// Initialize NFC
const nfc = new NFC();

// Helper functions from alt.js
const UID_REPLACEMENT = "U".repeat(uidAsciiLength);
const COUNTER_REPLACEMENT = "C".repeat(counterAsciiLength);
const CMAC_REPLACEMENT = "M".repeat(cmacAsciiLength);

function generateNDEF(url) {
  let SDMMACInputOffset = url.indexOf(CMAC_START_TAG);
  if (SDMMACInputOffset !== NOT_FOUND) {
    SDMMACInputOffset--;
  }

  url = url.replace(UID_TAG, UID_REPLACEMENT);
  url = url.replace(COUNTER_TAG, COUNTER_REPLACEMENT);
  url = url.replace(CMAC_TAG, CMAC_REPLACEMENT);
  url = url.replace(CMAC_START_TAG, "");

  const message = [NDEF.uriRecord(url)];
  const bytes = Buffer.from(NDEF.encodeMessage(message));

  const ndefLength = bytes.length;
  const buffer = Buffer.from([0x00, 0x00, ...bytes]);
  buffer.writeUInt16BE(ndefLength);

  const results = {
    ndef: buffer
  };
  
  const UIDOffset = buffer.indexOf(UID_REPLACEMENT);
  if (UIDOffset !== NOT_FOUND) {
    buffer.fill("0", UIDOffset, UIDOffset + uidAsciiLength);
    results["UIDOffset"] = UIDOffset;
  }

  const SDMReadCtrOffset = buffer.indexOf(COUNTER_REPLACEMENT);
  if (SDMReadCtrOffset !== NOT_FOUND) {
    buffer.fill("0", SDMReadCtrOffset, SDMReadCtrOffset + counterAsciiLength);
    results["SDMReadCtrOffset"] = SDMReadCtrOffset;
  }

  const SDMMACOffset = buffer.indexOf(CMAC_REPLACEMENT);
  if (SDMMACOffset !== NOT_FOUND) {
    buffer.fill("0", SDMMACOffset, SDMMACOffset + cmacAsciiLength);
    results["SDMMACOffset"] = SDMMACOffset;
  }
  
  if (SDMMACInputOffset === NOT_FOUND) {
    if (SDMMACOffset !== NOT_FOUND) {
      results["SDMMACInputOffset"] = SDMMACOffset;
    }
  } else {
    results["SDMMACInputOffset"] = SDMMACInputOffset;
  }

  if (UIDOffset !== NOT_FOUND && SDMReadCtrOffset !== NOT_FOUND) {
    if (
      UIDOffset >= SDMReadCtrOffset + counterAsciiLength ||
      SDMReadCtrOffset >= UIDOffset + uidAsciiLength
    ) {
      // OK
    } else {
      throw new Error("UID and counter cannot overlap");
    }
  }
  
  return results;
}

function compareNdef(currentNdef, newNdef, offsets) {
  const {
    UIDOffset,
    SDMReadCtrOffset,
    SDMMACOffset
  } = offsets;
  const normalizedNdef = Buffer.from(currentNdef);

  if (UIDOffset) {
    normalizedNdef.fill("0", UIDOffset, Math.min(UIDOffset + uidAsciiLength, normalizedNdef.length));
  }
  if (SDMReadCtrOffset) {
    normalizedNdef.fill("0", SDMReadCtrOffset, Math.min(SDMReadCtrOffset + counterAsciiLength, normalizedNdef.length));
  }
  if (SDMMACOffset) {
    normalizedNdef.fill("0", SDMMACOffset, Math.min(SDMMACOffset + cmacAsciiLength, normalizedNdef.length));
  }

  return Buffer.compare(normalizedNdef, newNdef);
}

function isFactorySettings(settings) {
  const factorySettings = Buffer.from('0000e0ee000100', 'hex');
  return Buffer.compare(settings, factorySettings) === 0;
}

function compareFileSettings(currentSettings, newSettings) {
  const normalizedSettings = Buffer.concat([
    currentSettings.slice(1, 4), // Omit FileType.StandardData
    currentSettings.slice(7), // Omit FileSize
  ]);
  return Buffer.compare(normalizedSettings, newSettings);
}

function parseSettings(settings) {
  let index = 0;
  const fileType = settings[index];
  index++;
  const fileOption = settings[index];
  index++;
  const accessRights = settings.readUInt16LE(index);

  const FileAR = {
    Read: ((accessRights & 0xf000) >> 12).toString(HEX),
    Write: ((accessRights & 0x0f00) >> 8).toString(HEX),
    ReadWrite: ((accessRights & 0x00f0) >> 4).toString(HEX),
    Change: ((accessRights & 0x000f) >> 0).toString(HEX),
  }

  index += 2;
  const fileSize = settings.readUIntLE(index, 3);
  index += 3;
  let SDMOptions, SDMAccessRights;
  if ((fileOption & 0x40) == 0x40) {
    SDMOptions = settings[index];
    index++;
    SDMAccessRights = settings.readUInt16LE(index);
    index += 2;
  }

  const SDMAR = {
    SDMMetaRead: ((SDMAccessRights & 0xf000) >> 12).toString(HEX),
    SDMFileRead: ((SDMAccessRights & 0x0f00) >> 8).toString(HEX),
    SDMCtrRet: ((SDMAccessRights & 0x000f) >> 0).toString(HEX),
  }

  const values = [];
  while (index < settings.length) {
    const value = settings.readUIntLE(index, 3);
    values.push(value);
    index += 3;
  }
  const [
    UIDOffset,
    SDMReadCtrOffset,
    SDMMACInputOffset,
    SDMMACOffset
  ] = values;

  return {
    fileType,
    fileOption,
    accessRights,
    FileAR,
    fileSize,
    SDMOptions,
    SDMAccessRights,
    SDMAR,
    UIDOffset,
    SDMReadCtrOffset,
    SDMMACInputOffset,
    SDMMACOffset
  };
}

function generateFileSettings(offsets, FileAR = {Read: 0xe, Write: 0xe, ReadWrite: 0xe, Change: 0xe}, SDMAR = {SDMMetaRead: 0xe, SDMFileRead: 0x0, SDMCtrRet: 0xf}) {
  const {
    UIDOffset,
    SDMReadCtrOffset,
    SDMReadCtrLimit,
    SDMENCFileData,
    SDMMACInputOffset,
    SDMMACOffset
  } = offsets;

  // Allow hex string values
  Object.keys(FileAR).forEach(key => {
    if (typeof FileAR[key] === 'string') {
      FileAR[key] = parseInt(FileAR[key], HEX)
    }
  })

  Object.keys(SDMAR).forEach(key => {
    if (typeof SDMAR[key] === 'string') {
      SDMAR[key] = parseInt(SDMAR[key], HEX)
    }
  })

  const { SDMMetaRead, SDMFileRead, SDMCtrRet } = SDMAR;

  let cmdData = Buffer.alloc(6);

  let fileOption = 0x00;
  if (UIDOffset || SDMReadCtrOffset || SDMMACInputOffset || SDMMACOffset) {
    fileOption = fileOption | 0x40;
  }

  let SDMOptions = 0x00;

  if ((fileOption & 0x40) == 0x40) {
    if (UIDOffset) {
      SDMOptions = SDMOptions | 0x80;
    }
    if (SDMReadCtrOffset) {
      SDMOptions = SDMOptions | 0x40;
    }
    if (SDMReadCtrLimit) {
      SDMOptions = SDMOptions | 0x20;
    }
    if (SDMENCFileData) {
      SDMOptions = SDMOptions | 0x10;
    }
    SDMOptions = SDMOptions | 0x01;
  }

  const accessRights = FileAR.Read << 12 | FileAR.Write << 8 | FileAR.ReadWrite << 4 | FileAR.Change;
  const SDMAccessRights =
    (SDMMetaRead << 12) | (SDMFileRead << 8) | (0xf << 4) | SDMCtrRet;

  let index = cmdData.writeUInt8(fileOption);
  index = cmdData.writeUInt16LE(accessRights, index);
  index = cmdData.writeUInt8(SDMOptions, index);
  index = cmdData.writeUInt16LE(SDMAccessRights, 4);

  if ((SDMOptions & 0x80) === 0x80 && SDMMetaRead === 0x0e) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(UIDOffset, index, 3);
  }
  if ((SDMOptions & 0x40) === 0x40 && SDMMetaRead === 0x0e) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMReadCtrOffset, index, 3);
  }
  if (SDMMetaRead >= 0 && SDMMetaRead <= 4) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(PICCDataOffset, index, 3);
  }
  if (SDMFileRead !== 0x0f) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMMACInputOffset, index, 3);
  }
  if (SDMFileRead !== 0x0f && (SDMOptions & 0x10) === 0x10) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMENCOffset, index, 3);
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMENCLength, index, 3);
  }
  if (SDMFileRead !== 0x0f) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMMACOffset, index, 3);
  }
  if ((SDMOptions & 0x20) === 0x20) {
    cmdData = Buffer.concat([cmdData, Buffer.alloc(3)]);
    index = cmdData.writeUIntLE(SDMReadCtrLimit, index, 3);
  }

  return cmdData;
}

function wrap(CLA = 0x00, ins, p1 = 0, p2 = 0, dataIn) {
  const length = dataIn.length;
  const buf = Buffer.from([CLA, ins, p1, p2, length, ...dataIn]);
  return [CLA, ins, p1, p2, length, ...dataIn, 0x00];
}

function deriveTagKey(masterKey, uid, keyNo) {
  // If using all zeros master key, return all zeros
  if (masterKey.every(byte => byte === 0)) {
    return Buffer.alloc(16).fill(0);
  }
  
  // Create the input for PBKDF2
  const salt = Buffer.concat([
    Buffer.from("key"), 
    uid, 
    Buffer.from([keyNo])
  ]);
  
  // Use crypto.pbkdf2Sync to match the Python implementation
  return crypto.pbkdf2Sync(masterKey, salt, 5000, 16, 'sha512');
}

// NFC card operations
class NFCOperations {
  constructor(reader) {
    this.reader = reader;
    this.cmdCtr = 0;
    this.commMode = CommMode.PLAIN;
    this.keys = Array(5).fill(factoryKey);
  }

  async send(cmd, comment = null, responseMaxLength = 40) {
    const b = typeof cmd === "string" ? Buffer.from(cmd, "hex") : Buffer.from(cmd);
    log.send((comment ? `[${comment}] ` : "") + `sending`, b);
    const data = await this.reader.transmit(b, responseMaxLength);
    log.recv((comment ? `[${comment}] ` : "") + `received data`, data);
    return data;
  }

  async sendFull(encryptionParams, INS, cmdHeader, cmdData, comment, control = {}) {
    let { SesAuthMAC, SesAuthENC, TI } = encryptionParams;

    // Calculate IV, encryption, mac for encrypted version
    const IV = Buffer.concat([
      Buffer.from("a55a", "hex"),
      TI,
      Buffer.alloc(2), // cmdCtr
      Buffer.alloc(8)
    ]);
    IV.writeUInt16LE(this.cmdCtr, 6);
    const IVc = encrypt(SesAuthENC, IV);

    const encryptedCmd = encrypt(SesAuthENC, Buffer.from(cmdData), IVc);
    const macIn = Buffer.from([
      INS,
      0x00,
      0x00,
      ...TI,
      cmdHeader,
      ...encryptedCmd
    ]);
    macIn.writeUInt16LE(this.cmdCtr, 1);
    const mac = MAC(SesAuthMAC, macIn);
    const mact = MACt(mac);

    const payload = Buffer.from([cmdHeader, ...encryptedCmd, ...mact]);

    if (Object.keys(control).length > 0) {
      console.log({
        control,
        calculated: {
          ...encryptionParams,
          cmdCtr: this.cmdCtr,
          INS: INS.toString(HEX),
          cmdHeader, cmdData,
          IV, IVc,
          encryptedCmd,
          macIn, mac, mact,
          payload,
        }
      });
    }

    const res = await this.send(
      wrap(0x90, INS, 0x00, 0x00, payload),
      comment
    );
    this.cmdCtr++;

    if (res.length === 2) { // ResponseCode
      if (res[1] !== 0x00) {
        throw new Error(`error in ${comment}: ${res.toString('hex')}`);
      }
    } else if (res.length === 10) { // rMact + ResponseCode
      const tMact = res.slice(0, 8); // target mact
      const ResponseCode = res.slice(8);
      const rMacInput = Buffer.from([
        0x00,
        0x00, 0x00, //cmdCtr
        ...TI
      ])
      rMacInput.writeUInt16LE(this.cmdCtr, 1);

      const rMac = MAC(SesAuthMAC, rMacInput);
      const rMact = MACt(rMac);
      if (!rMact.equals(tMact)) {
        throw new Error(`error in ${comment}`);
      }
    } else {
      console.log("response contained data, but I haven't coded how to handle that");
    }
    
    return res;
  }

  async getUid() {
    const res = await this.send([0xff, 0xca, 0x00, 0x00, 0x00], "get uid");
    if (res.slice(-1)[0] !== 0x00) {
      throw new Error("error getting uid");
    }
    return res.slice(0, -2);
  }

  async authenticate(keyNo) {
    const LenCap = 0x00;
    const key = keyNo === 'factory' ? factoryKey : this.keys[keyNo];

    const res1 = await this.send(
      wrap(0x90, 0x71, 0x00, 0x00, [keyNo, LenCap]),
      "authenticate"
    );

    if (res1.slice(-1)[0] !== 0xaf) {
      throw new Error("error in authenticate");
    }

    const ecRndB = res1.slice(0, -2);
    const RndB = decrypt(key, ecRndB);
    const RndBp = rotateLeft(RndB);
    const RndA = crypto.randomBytes(RndB.length);
    const msg = encrypt(key, Buffer.concat([RndA, RndBp]));
    const res2 = await this.send(wrap(0x90, 0xaf, 0x00, 0x00, msg), "set up RndA");

    if (res2.slice(-1)[0] !== 0x00) {
      throw new Error("error in set up RndA");
    }
    const ecRndAp = res2.slice(0, -2);

    const TiRndAPDcap2PCDcap2 = decrypt(key, ecRndAp);
    const TI = TiRndAPDcap2PCDcap2.slice(0, 4);
    const RndAp = TiRndAPDcap2PCDcap2.slice(4, 20);
    const PDcap2 = TiRndAPDcap2PCDcap2.slice(20, 26);
    const PCDcap2 = TiRndAPDcap2PCDcap2.slice(26);

    // rotate
    const RndA2 = rotateRight(RndAp);

    // compare decrypted RndA2 response from reader with our RndA
    // if it equals authentication process was successful
    if (!RndA.equals(RndA2)) {
      throw new Error("error in match RndA random bytes");
    }
    this.cmdCtr = 0; // I think this gets reset with authentication
    this.commMode = CommMode.FULL;
    console.log('authenticated using keyNo', keyNo);

    const { SesAuthENC, SesAuthMAC } = calcSessionKeys(key, RndA, RndB);
    return { TI, SesAuthENC, SesAuthMAC };
  }

  async changeKey(keyNo, newKey, encryptionParams) {
    let { SesAuthMAC, SesAuthENC, TI } = encryptionParams;
    const INS = 0xc4;

    const IV = Buffer.concat([
      Buffer.from("a55a", "hex"),
      TI,
      Buffer.alloc(2), // cmdCtr
      Buffer.alloc(8)
    ]);
    IV.writeUInt16LE(this.cmdCtr, 6);

    const oldKey = factoryKey;
    const newKeyVersion = 0x01;
    let keyData;

    if (keyNo === 0) {
      keyData = Buffer.from([
        ...newKey,
        newKeyVersion,
        0x80,
        ...Buffer.alloc(14).fill(0),
      ])
    } else {
      const keyXor = Buffer.alloc(0x10).fill(0);
      for (var i = 0; i < 0x10; i++) {
        keyXor[i] = newKey[i] ^ oldKey[i];
      }
      const crc32 = crcjam(newKey);

      keyData = Buffer.from([
        ...keyXor,
        newKeyVersion,
        ...Buffer.alloc(4),
        0x80,
        ...Buffer.alloc(10)
      ]);
      keyData.writeUInt32LE(crc32, 17);
    }
    
    if (this.commMode === CommMode.FULL) {
      await this.sendFull(encryptionParams, INS, keyNo, keyData, 'changeKey');
    } else {
      throw new Error("pretty sure you can't change a key without using CommMode.FULL");
    }
  }

  async getFileSettings() {
    let res = await this.send(
      wrap(0x90, 0xf5, 0x00, 0x00, [0x02]),
      "get file settings"
    );
    if (res.slice(-1)[0] !== 0x00) {
      throw new Error("error in getting file settings");
    }

    const settings = res.slice(0, -2);
    return settings;
  }

  async setFileSettings(cmdData, encryptionParams = {}) {
    const cmd = 0x5f;
    const fileNo = 0x02;

    if (this.commMode === CommMode.FULL) {
      return await this.sendFull(encryptionParams, cmd, fileNo, cmdData, 'setFileSettings');
    } else if (this.commMode === CommMode.PLAIN) {
      const settings = Buffer.from([fileNo, ...cmdData]);
      const res = await this.send(
        wrap(0x90, cmd, 0x00, 0x00, settings),
        "set file settings"
      );
      if (res.slice(-1)[0] !== 0x00) {
        throw new Error("error in setting file settings");
      }
    }
  }

  async writeNdef(ndef, encryptionParams = {}) {
    let res = await this.send(
      wrap(0x00, 0xa4, 0x00, 0x0c, ndefFileId),
      "select file"
    );

    if (!success.equals(res.slice(-2))) {
      throw new Error("error in select file");
    }

    log.ndef("new ndef: " + ndef.toString("hex"));

    // CommMode.PLAIN
    const cmd = [0x00, 0xd6, 0x00, 0x00, ndef.length, ...ndef];

    res = await this.send(cmd, "write ndef");
    if (!success.equals(res.slice(-2))) {
      throw new Error("error in write ndef");
    }
    
    return { success: true };
  }

  async readNdef() {
    let res = await this.send(
      wrap(0x00, 0xa4, 0x00, 0x0c, ndefFileId),
      "select file"
    );

    if (res.slice(-1)[0] !== 0x00) {
      throw new Error("error in select file");
    }

    res = await this.send([0x00, 0xb0, 0x00, 0x00, 0x80], "read ndef", 0x80 + 2);
    if (!success.equals(res.slice(-2))) {
      throw new Error("error in read ndef");
    }

    const length = res.readUInt16BE();
    // NOTE: I leave the length on for symmetry with generateNDEF
    const ndefData = res.slice(0, 2 + length);
    
    try {
      // Ignore 2 length bytes
      const ndefRecords = NDEF.decodeMessage(ndefData.slice(2));
      if (ndefRecords.length > 0) {
        const record = ndefRecords[0];
        const { tnf, type, payload, value } = record;
        if (tnf === NDEF.TNF_WELL_KNOWN && type === NDEF.RTD_URI) {
          return { 
            ndef: ndefData, 
            decoded: { 
              tnf, 
              type, 
              payload: payload.toString('hex'), 
              value 
            } 
          };
        }
        return { 
          ndef: ndefData, 
          decoded: { 
            tnf, 
            type, 
            payload: payload.toString('hex') 
          } 
        };
      }
    } catch (e) {
      console.error("Error decoding NDEF:", e);
    }
    
    return { ndef: ndefData };
  }

  async personalize(url) {
    try {
      // Get UID
      const UID = await this.getUid();
      
      // Derive keys from master key and UID
      for (var i = 0; i < 5; i++) {
        this.keys[i] = deriveTagKey(masterKey, UID, i);
      }
      log.keys({ keys: this.keys });

      // Select NDEF application
      let res = await this.send(wrap(0x00, 0xa4, 0x04, 0x0c, ndefAid), "select app");
      
      // Get current file settings
      let fileSettings = await this.getFileSettings();
      const parsed = parseSettings(fileSettings);
      log.settings('file settings', parsed);

      // Generate new NDEF message
      const { ndef, ...offsets } = generateNDEF(url);

      // Try to write NDEF if permissions allow
      let keyNo = parseInt(parsed.FileAR.Write, HEX);
      if (keyNo === 0xe) {
        await this.writeNdef(ndef);
      }

      // Read current NDEF
      const { ndef: currentNdef } = await this.readNdef();

      // If NDEF needs to be updated
      if (compareNdef(currentNdef, ndef, parsed) !== 0) {
        keyNo = parseInt(parsed.FileAR.Write, HEX);
        if (keyNo === 0x0e) {
          await this.writeNdef(ndef);
        } else {
          console.log('skipping ndef write', { keyNo });
        }
      }

      // Generate new file settings
      const lockDownFileAR = { Read: 'e', Write: '0', ReadWrite: '0', Change: '0' };
      const lockDownSDMAR = { SDMMetaRead: 'e', SDMFileRead: '0', SDMCtrRet: 'f' };
      const newSettings = generateFileSettings(offsets, lockDownFileAR, lockDownSDMAR);

      // Check if we have factory settings
      const factory = isFactorySettings(fileSettings);
      let auth = {};
      
      // Process factory settings
      if (factory) {
        try {
          // Authenticate with factory key and change keys
          auth = await this.authenticate('factory');
          await this.changeKey(0, this.keys[0], auth);
          auth = await this.authenticate(0);

          for (var i = 1; i < 5; i++) {
            const newKey = this.keys[i];
            await this.changeKey(i, newKey, auth);
          }
          console.log('keys updated');

          // Set file settings
          try {
            const exampleFileSettings = Buffer.from('40EEEEC1F121200000430000430000', 'hex');
            if (this.commMode !== CommMode.FULL) {
              auth = await this.authenticate('factory');
            }
            await this.setFileSettings(exampleFileSettings, auth);
            this.commMode = CommMode.PLAIN;
            await this.setFileSettings(newSettings);
          } catch (e) {
            console.log('Error changing file settings to example value', e);
            throw e;
          }
        } catch (e) {
          console.log('Error changing keys', e);
          throw e;
        }
      } else if (compareFileSettings(fileSettings, newSettings) !== 0) {
        // Update file settings if needed
        keyNo = parseInt(parsed.FileAR.Change, HEX);
        if (keyNo !== 0xE && this.commMode !== CommMode.FULL) {
          auth = await this.authenticate(keyNo);
        }
        await this.setFileSettings(newSettings, auth);
      }

      return {
        success: true,
        uid: formatUid(UID),
        isFactory: factory,
        message: factory ? "Tag personalized with new keys and settings" : "Tag updated with new settings"
      };
    } catch (err) {
      console.error(`Error personalizing tag:`, err);
      throw err;
    }
  }
}

// API Endpoints
app.get('/status', (req, res) => {
  res.json({
    isReaderReady,
    reader: nfcReader ? nfcReader.reader.name : null,
    lastError,
    masterKeyConfigured: !!MASTER_KEY_HEX,
    readerConfigured: !!CL_READER
  });
});

// Get UID of currently presented card
app.get('/card/uid', async (req, res) => {
  if (!isReaderReady) {
    return res.status(503).json({ error: 'NFC reader not ready' });
  }
  
  if (!currentCard) {
    return res.status(404).json({ error: 'No card detected' });
  }
  
  try {
    const nfcOps = new NFCOperations(nfcReader);
    const uid = await nfcOps.getUid();
    res.json({ uid: formatUid(uid) });
  } catch (error) {
    console.error('Error reading UID:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file settings
app.get('/card/settings', async (req, res) => {
  if (!isReaderReady) {
    return res.status(503).json({ error: 'NFC reader not ready' });
  }
  
  if (!currentCard) {
    return res.status(404).json({ error: 'No card detected' });
  }
  
  try {
    const nfcOps = new NFCOperations(nfcReader);
    // First select NDEF application
    await nfcOps.send(wrap(0x00, 0xa4, 0x04, 0x0c, ndefAid), "select app");
    const settings = await nfcOps.getFileSettings();
    const parsed = parseSettings(settings);
    res.json({
      raw: settings.toString('hex'),
      parsed
    });
  } catch (error) {
    console.error('Error getting file settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Personalize tag with verification URL
app.post('/card/personalize', async (req, res) => {
  if (!isReaderReady) {
    return res.status(503).json({ error: 'NFC reader not ready' });
  }
  
  if (!currentCard) {
    return res.status(404).json({ error: 'No card detected' });
  }
  
  // Use the provided URL or default to the verification URL format
  let { url } = req.body;
  
  if (!url) {
    // Default URL pattern with parameters for verification
    const baseUrl = req.body.baseUrl || 'https://sdm.nfcdeveloper.com';
    url = `${baseUrl}/tagpt?uid={uid}&ctr={counter}&cmac={cmac}`;
  }
  
  if (!MASTER_KEY_HEX) {
    return res.status(400).json({ error: 'Master key not configured' });
  }
  
  try {
    const nfcOps = new NFCOperations(nfcReader);
    const result = await nfcOps.personalize(url);
    res.json(result);
  } catch (error) {
    console.error('Error personalizing tag:', error);
    res.status(500).json({ error: error.message });
  }
});

// Event listener for NFC reader
nfc.on("reader", (reader) => {
  reader.autoProcessing = false;
  console.log('Found NFC reader:', reader.reader.name);
  
  if (reader.reader.name === CL_READER) {
    nfcReader = reader;
    isReaderReady = true;
    lastError = null;
    log.api(`Reader "${reader.reader.name}" is now active`);
    
    reader.on("card", (card) => {
      log.api(`Card detected:`, card);
      currentCard = card;
    });
    
    reader.on("card.off", (card) => {
      log.api(`Card removed:`, card);
      currentCard = null;
    });
    
    reader.on("error", (err) => {
      console.error(`Reader error:`, err);
      lastError = err.message;
    });
    
    reader.on("end", () => {
      log.api(`Reader "${reader.reader.name}" removed`);
      if (nfcReader === reader) {
        nfcReader = null;
        isReaderReady = false;
      }
    });
  }
});

nfc.on("error", (err) => {
  console.error(`NFC error:`, err);
  lastError = err.message;
});

// Start the server
app.listen(PORT, () => {
  console.log(`NFC API server running on port ${PORT}`);
});