const crypto = require("crypto");
const { aesCmac } = require("node-aes-cmac");

const blockSize = 16;
const cipher = "aes-128-cbc";

function calcSessionKeys(key, RndA, RndB) {
  const xor = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) {
    xor[i] = RndA[2 + i] ^ RndB[i];
  }

  const sv1 = Buffer.concat([
    Buffer.from("a55a00010080", "hex"),
    RndA.slice(0, 2),
    xor,
    RndB.slice(6),
    RndA.slice(8)
  ]);

  const sv2 = Buffer.concat([
    Buffer.from("5aa500010080", "hex"),
    RndA.slice(0, 2),
    xor,
    RndB.slice(6),
    RndA.slice(8)
  ]);

  const SesAuthENC = MAC(key, sv1);
  const SesAuthMAC = MAC(key, sv2);

  return { SesAuthENC, SesAuthMAC };
}

function decrypt(key, data, iv = Buffer.alloc(blockSize).fill(0)) {
  const decipher = crypto.createDecipheriv(
    cipher,
    key,
    iv
  );
  decipher.setAutoPadding(false);

  // Encrypted data should already be block-aligned
  if (data.length % blockSize !== 0) {
    throw new Error(`Encrypted data length (${data.length}) is not a multiple of block size (${blockSize})`);
  }

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  // Remove ISO/IEC 9797-1 padding method 2: find 0x80 byte, remove it and everything after
  // Work backwards from the end to find the 0x80 marker
  let unpaddedLength = decrypted.length;
  for (let i = decrypted.length - 1; i >= 0; i--) {
    if (decrypted[i] === 0x80) {
      unpaddedLength = i;
      break;
    }
    if (decrypted[i] !== 0x00) {
      // No valid padding found - return as is
      return decrypted;
    }
  }

  return decrypted.slice(0, unpaddedLength);
}

function encrypt(key, data, iv = Buffer.alloc(blockSize).fill(0)) {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);

  // ISO/IEC 9797-1 padding method 2 (also known as ISO/IEC 7816-4 padding)
  // Add 0x80 byte followed by 0x00 bytes to reach block boundary
  const padLen = blockSize - (data.length % blockSize);
  if (padLen !== blockSize) {
    const padding = Buffer.alloc(padLen);
    padding[0] = 0x80;  // First byte is 0x80, rest are 0x00 (already initialized)
    data = Buffer.concat([data, padding]);
  }

  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function MAC(key, data) {
  return aesCmac(key, data, { returnAsBuffer: true });
}

function MACt(mac) {
  const mact = Buffer.alloc(8);
  for (let i = 0; i < mac.length; i++) {
    if (i % 2 == 1) {
      mact[(i / 2) >>> 0] = mac[i];
    }
  }
  return mact;
}

function rotateLeft(buff) {
  return Buffer.concat([buff.slice(1), buff.slice(0, 1)]);
}

function rotateRight(buff) {
  return Buffer.concat([
    buff.slice(buff.length - 1),
    buff.slice(0, buff.length - 1)
  ]);
}

function AES128KeyDiversification(m, masterKey) {
  const divConst = 0x01;
  const d = Buffer.from([divConst, ...m])
  return MAC(masterKey, d)
}

function testCalcSessionKeys() {
  const key = Buffer.alloc(0x10).fill(0);
  const RndA = Buffer.from('B98F4C50CF1C2E084FD150E33992B048', 'hex');
  const RndB = Buffer.from('91517975190DCEA6104948EFA3085C1B', 'hex');
  const { SesAuthENC, SesAuthMAC } = calcSessionKeys(key, RndA, RndB);
  const control = {
    SesAuthMAC: Buffer.from('FC4AF159B62E549B5812394CAB1918CC', 'hex'),
    SesAuthENC: Buffer.from('7A93D6571E4B180FCA6AC90C9A7488D4', 'hex'),
  }

  if (!control.SesAuthENC.equals(SesAuthENC)) {
    throw new Error("SesAuthENC doesn't match control value");
  }
  if (!control.SesAuthMAC.equals(SesAuthMAC)) {
    throw new Error("SesAuthMAC doesn't match control value");
  }
}

testCalcSessionKeys();


module.exports = {
  calcSessionKeys,
  decrypt,
  encrypt,
  MAC,
  MACt,
  rotateLeft,
  rotateRight,
  AES128KeyDiversification,
}
