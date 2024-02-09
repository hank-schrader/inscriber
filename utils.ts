import { TEST_API } from "./consts";
import { ApiUTXO, Chunk, ICalculateFeeForPsbtWithManyOutputs } from "./types";
import { Psbt, script as belScript, opcodes, Transaction } from "belcoinjs-lib";

export async function getHexes(utxos: ApiUTXO[]): Promise<string[]> {
  const hexes = [];
  for (const utxo of utxos) {
    const hex = await (await fetch(`${TEST_API}/tx/${utxo.txid}/hex`)).text();
    hexes.push(hex);
  }
  return hexes;
}

export function calculateFeeForPsbtWithManyOutputs({
  psbt,
  outputAmount,
  feeRate,
  address,
  pair,
}: ICalculateFeeForPsbtWithManyOutputs) {
  for (let i = 0; i < outputAmount; i++) {
    psbt.addOutput({
      address: address,
      value: 0,
    });
  }

  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  let txSize = psbt.extractTransaction(true).toBuffer().length;
  const fee = Math.ceil(txSize * feeRate);
  return fee;
}

export function calculateFeeForPsbt(
  psbt: Psbt,
  pair: any,
  finalizeMethod: (psbt: Psbt) => void,
  feeRate: number,
  address: string
): number {
  psbt.addOutput({
    address: address,
    value: 0,
  });
  psbt.signAllInputs(pair);
  finalizeMethod(psbt);
  let txSize = psbt.extractTransaction(true).toBuffer().length;
  const fee = Math.ceil(txSize * feeRate);
  return fee;
}

export function calculateFeeForLastTx({
  psbt,
  feeRate,
  pair,
  lastPartial,
  lastLock,
  address,
}: {
  psbt: Psbt;
  feeRate: number;
  pair: any;
  lastPartial: Buffer[];
  lastLock: Buffer;
  address: string;
}): number {
  psbt.addOutput({
    address: address,
    value: 0,
  });
  psbt.signAllInputs(pair);
  const signature = psbt.data.inputs[0].partialSig![0].signature;
  const signatureWithHashType = Buffer.concat([
    signature,
    belScript.number.encode(Transaction.SIGHASH_ALL),
  ]);

  const unlockScript = belScript.compile([
    ...lastPartial,
    signatureWithHashType,
    lastLock,
  ]);

  psbt.finalizeInput(0, (_: any, input: any, script: any) => {
    return {
      finalScriptSig: unlockScript,
      finalScriptWitness: undefined,
    };
  });
  psbt.finalizeInput(1);
  let txSize = psbt.extractTransaction(true).toBuffer().length;
  const fee = Math.ceil(txSize * feeRate);
  return fee;
}

export function compile(chunks: Chunk[]) {
  var buffers: Buffer[] = [];
  var bufferLength = 0;

  function writeUInt8(n: number) {
    var buf = Buffer.alloc(1);
    buf.writeUInt8(n, 0);
    write(buf);
  }

  function writeUInt16LE(n: number) {
    var buf = Buffer.alloc(2);
    buf.writeUInt16LE(n, 0);
    write(buf);
  }

  function writeUInt32LE(n: number) {
    var buf = Buffer.alloc(4);
    buf.writeUInt32LE(n, 0);
    write(buf);
  }

  function write(buf: Buffer) {
    buffers.push(buf);
    bufferLength += buf.length;
  }

  function concat() {
    return Buffer.concat(buffers, bufferLength);
  }

  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    var opcodenum = chunk.opcodenum;
    writeUInt8(chunk.opcodenum);
    if (chunk.buf) {
      if (opcodenum < opcodes.OP_PUSHDATA1) {
        write(chunk.buf);
      } else if (opcodenum === opcodes.OP_PUSHDATA1) {
        writeUInt8(chunk.len!);
        write(chunk.buf);
      } else if (opcodenum === opcodes.OP_PUSHDATA2) {
        writeUInt16LE(chunk.len!);
        write(chunk.buf);
      } else if (opcodenum === opcodes.OP_PUSHDATA4) {
        writeUInt32LE(chunk.len!);
        write(chunk.buf);
      }
    }
  }

  return concat();
}

export function bufferToChunk(b: Buffer): Chunk {
  return {
    buf: b.length ? b : undefined,
    len: b.length,
    opcodenum: b.length <= 75 ? b.length : b.length <= 255 ? 76 : 77,
  };
}

export function numberToChunk(n: number): Chunk {
  return {
    buf:
      n <= 16
        ? undefined
        : n < 128
        ? Buffer.from([n])
        : Buffer.from([n % 256, n / 256]),
    len: n <= 16 ? 0 : n < 128 ? 1 : 2,
    opcodenum: n == 0 ? 0 : n <= 16 ? 80 + n : n < 128 ? 1 : 2,
  };
}

export function opcodeToChunk(op: number): Chunk {
  return { opcodenum: op };
}

export function calculateTransactionNumber(inscription: Chunk[]): number {
  const txs = [];
  while (inscription.length) {
    let partial: Chunk[] = [];

    if (txs.length == 0) {
      partial.push(inscription.shift()!);
    }

    while (compile(partial).length <= 1500 && inscription.length) {
      partial.push(inscription.shift()!);
      partial.push(inscription.shift()!);
    }

    if (compile(partial).length > 1500) {
      inscription.unshift(partial.pop()!);
      inscription.unshift(partial.pop()!);
    }

    txs.push(partial);
  }
  return txs.length + 1;
}
