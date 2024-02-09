import { ApiUTXO, Chunk, IWallet } from "./types";
import { Psbt, networks, crypto as belCrypto, opcodes } from "belcoinjs-lib";
import ECPair from "./ecpair";
import {
  bufferToChunk,
  calculateFeeForLastTx,
  calculateFeeForPsbt,
  calculateTransactionNumber,
  compile,
  getHexes,
  numberToChunk,
  opcodeToChunk,
} from "./utils";

const MAX_CHUNK_LEN = 240;
const MAX_PAYLOAD_LEN = 1500;

async function inscribe(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  feeRate: number
): Promise<string[]> {
  const pair = ECPair.fromWIF(wallet.secret);
  let parts = [];
  const txs: string[] = [];
  const utxos = wallet.utxos;
  const hexes = await getHexes(wallet.utxos);
  for (const i of utxos) {
    i.rawHex = hexes.shift()!;
  }

  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(part);
  }

  const inscription: Chunk[] = [
    bufferToChunk(Buffer.from("ord", "utf8")),
    numberToChunk(parts.length),
    bufferToChunk(Buffer.from(contentType, "utf8")),
    ...parts.flatMap((part, n) => [
      numberToChunk(parts.length - n - 1),
      bufferToChunk(part),
    ]),
  ];

  let p2shInput: any | undefined = undefined;
  let lastLock: any | undefined = undefined;
  let lastPartial: any | undefined = undefined;

  while (inscription.length) {
    let partial: Chunk[] = [];

    if (txs.length == 0) {
      partial.push(inscription.shift()!);
    }

    while (compile(partial).length <= MAX_PAYLOAD_LEN && inscription.length) {
      partial.push(inscription.shift()!);
      partial.push(inscription.shift()!);
    }

    if (compile(partial).length > MAX_PAYLOAD_LEN) {
      inscription.unshift(partial.pop()!);
      inscription.unshift(partial.pop()!);
    }

    const lock = compile([
      bufferToChunk(pair.publicKey),
      opcodeToChunk(opcodes.OP_CHECKSIGVERIFY),
      ...partial.map(() => opcodeToChunk(opcodes.OP_DROP)),
      opcodeToChunk(opcodes.OP_TRUE),
    ]);

    const lockHash = belCrypto.hash160(lock);

    const p2shScript = compile([
      opcodeToChunk(opcodes.OP_HASH160),
      bufferToChunk(lockHash),
      opcodeToChunk(opcodes.OP_EQUAL),
    ]);

    const p2shOutput = {
      script: p2shScript,
      value: 100000,
    };

    const tx = new Psbt({ network: networks.bitcoin });
    tx.setVersion(1);

    if (p2shInput) tx.addInput(p2shInput);
    tx.addOutput(p2shOutput);

    let change = 0;
    const usedUtxos: ApiUTXO[] = [];
    const availableUtxos = utxos;
    while (change <= 0 && availableUtxos.length > 0) {
      tx.addInput({
        hash: availableUtxos[0].txid,
        index: availableUtxos[0].vout,
        sequence: 0xfffffffe,
        nonWitnessUtxo: Buffer.from(availableUtxos[0].rawHex!, "hex"),
      });
      availableUtxos.shift();
      usedUtxos.push(availableUtxos[0]);

      let fee = 0;

      if (p2shInput === undefined) {
        fee = calculateFeeForPsbt(
          tx.clone(),
          pair,
          (psbt) => {
            return psbt.finalizeAllInputs();
          },
          feeRate,
          wallet.address
        );
      } else {
        fee = calculateFeeForLastTx({
          feeRate,
          pair,
          psbt: tx.clone(),
          lastPartial,
          lastLock,
          address: wallet.address,
        });
      }

      change =
        usedUtxos.reduce((accumulator, utxo) => accumulator + utxo.value, 0) -
        fee -
        100000;
      if (change <= 0 && availableUtxos.length <= 1)
        throw new Error("Insufficient funds");
      else tx.addOutput({ address: wallet.address, value: change });
    }

    utxos.splice(0, usedUtxos.length);

    tx.signAllInputs(pair);

    if (p2shInput !== undefined) {
      const signature = tx.data.inputs[0].partialSig![0].signature;

      const unlockScript = compile([
        ...lastPartial,
        bufferToChunk(signature),
        bufferToChunk(lastLock),
      ]);

      tx.finalizeInput(0, (_: any, input: any, script: any) => {
        return {
          finalScriptSig: unlockScript,
          finalScriptWitness: undefined,
        };
      });
      tx.finalizeInput(1);
    } else tx.finalizeAllInputs();

    txs.push(tx.extractTransaction(true).toHex());

    const transaction = tx.extractTransaction(true);
    p2shInput = {
      hash: transaction.getId(),
      index: 0,
      nonWitnessUtxo: transaction.toBuffer(),
      redeemScript: lock,
    };
    lastPartial = partial;
    lastLock = lock;
  }

  const lastTx = new Psbt({ network: networks.bitcoin });
  lastTx.setVersion(1);
  lastTx.addInput(p2shInput);
  lastTx.addOutput({ address: address, value: 100000 });
  lastTx.addOutput({
    address: "BDJqmvvM2Ceh3JcguE3xScBUAGE88nJjcj",
    value: 1000000,
  });

  let change = 0;
  const usedUtxos: ApiUTXO[] = [];
  const availableUtxos = utxos;
  while (change <= 0 && availableUtxos.length > 0) {
    lastTx.addInput({
      hash: availableUtxos[0].txid,
      index: availableUtxos[0].vout,
      sequence: 0xfffffffe,
      nonWitnessUtxo: Buffer.from(availableUtxos[0].rawHex!, "hex"),
    });
    availableUtxos.shift();
    usedUtxos.push(availableUtxos[0]);

    const fee = calculateFeeForLastTx({
      feeRate,
      pair,
      psbt: lastTx.clone(),
      lastPartial,
      lastLock,
      address: wallet.address,
    });

    change =
      usedUtxos.reduce((accumulator, utxo) => accumulator + utxo.value, 0) -
      fee -
      100000 -
      1000000;
    if (change <= 0 && availableUtxos.length <= 1)
      throw new Error("Insufficient funds");
    else lastTx.addOutput({ address: wallet.address, value: change });
  }

  lastTx.signAllInputs(pair);

  const signature = lastTx.data.inputs[0].partialSig![0].signature;

  const unlockScript = compile([
    ...lastPartial,
    bufferToChunk(signature),
    bufferToChunk(lastLock),
  ]);

  lastTx.finalizeInput(0, (_: any, input: any, script: any) => {
    return {
      finalScriptSig: unlockScript,
      finalScriptWitness: undefined,
    };
  });
  lastTx.finalizeInput(1);

  const finalizedTx = lastTx.extractTransaction(true);
  txs.push(finalizedTx.toHex());

  return txs;
}
export default inscribe;
