const crypto = require("crypto");
const { aesCmac } = require("node-aes-cmac");

const blockSize = 16;
const cipher = "aes-128-cbc";

function calcSessionKeys(key, RndA, RndB) {
  const xor = Buffer.alloc(6);
  for (var i = 0; i < 6; i++) {
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

function decrypt(key, data) {
  const decipher = crypto.createDecipheriv(
    cipher,
    key,
    Buffer.alloc(blockSize)
  );
  decipher.setAutoPadding(false);
  const padLen = blockSize - (data.length % blockSize);
  if (padLen !== blockSize) {
    data = Buffer.concat([data, Buffer.alloc(padLen).fill(0x80)]);
  }

  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function encrypt(key, data, iv = Buffer.alloc(blockSize).fill(0)) {
  const decipher = crypto.createCipheriv(cipher, key, iv);
  decipher.setAutoPadding(false);
  const padLen = blockSize - (data.length % blockSize);
  // Do I always need to add at least on 0x80?
  // https://github.com/icedevml/nfc-ev2-crypto/blob/master/comm.py#L218

  if (padLen !== blockSize) {
    data = Buffer.concat([data, Buffer.alloc(padLen).fill(0x80)]);
  }

  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function MAC(key, data) {
  return aesCmac(key, data, { returnAsBuffer: true });
}

function MACt(mac) {
  const mact = Buffer.alloc(8);
  for (var i = 0; i < mac.length; i++) {
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
