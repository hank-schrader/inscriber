import { ApiUTXO, Chunk, IWallet } from "./types";
import {
  Psbt,
  networks,
  crypto as belCrypto,
  opcodes,
  Transaction,
  payments,
} from "belcoinjs-lib";
import ECPair from "./ecpair";
import { bufferToChunk, compile, numberToChunk, opcodeToChunk } from "./utils";
import { UTXO_VALUE } from "./consts";

export const MAX_CHUNK_LEN = 240;
export const MAX_PAYLOAD_LEN = 1500;

function inscribeWithWeights(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  utxos: ApiUTXO[],
  weights: number[],
  requiredValue: number
): string[] {
  const pair = ECPair.fromWIF(wallet.secret);

  if (!utxos.length) {
    const fakeValue = 99999999999999;
    let fakeTx = new Transaction();
    let fakeTxid = new Array(64).fill(0).join("");
    fakeTx.addInput(Buffer.from(fakeTxid, "hex"), 0);
    fakeTx.addOutput(
      payments.p2pkh({ pubkey: pair.publicKey, network: networks.testnet })
        .output!,
      fakeValue
    );
    utxos.push({
      hex: fakeTx.toHex(),
      value: fakeValue,
      txid: fakeTx.getId(),
      vout: 0,
    });
  }

  let parts = [];
  const txs: string[] = [];
  let nintondoFee = 1_000_000;

  let totalValue = requiredValue;

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

    let fee = weights.shift()!;
    totalValue -= fee;

    const p2shOutput = {
      script: p2shScript,
      value: totalValue,
    };

    const tx = new Psbt({ network: networks.testnet });
    tx.setVersion(1);

    tx.addOutput(p2shOutput);

    if (p2shInput) {
      tx.addInput(p2shInput);
    } else {
      for (let i of utxos) {
        tx.addInput({
          hash: i.txid,
          index: i.vout,
          nonWitnessUtxo: Buffer.from(i.hex!, "hex"),
        });
      }

      const change =
        utxos.reduce((acc, val) => (acc += val.value), 0) - (totalValue + fee);
      if (change >= 1000) {
        tx.addOutput({ address, value: change });
      }
    }

    tx.signAllInputs(pair);

    if (p2shInput !== undefined) {
      const signature = tx.data.inputs[0].partialSig![0].signature;

      const unlockScript = compile([
        ...lastPartial,
        bufferToChunk(signature),
        bufferToChunk(lastLock),
      ]);

      tx.finalizeInput(0, () => {
        return {
          finalScriptSig: unlockScript,
          finalScriptWitness: undefined,
        };
      });
    } else tx.finalizeAllInputs();

    txs.push(tx.extractTransaction(true).toHex());

    const transaction = tx.extractTransaction(true);

    nintondoFee += 100_000;

    p2shInput = {
      hash: transaction.getId(),
      index: 0,
      nonWitnessUtxo: transaction.toBuffer(),
      redeemScript: lock,
    };
    lastPartial = partial;
    lastLock = lock;
  }

  const lastTx = new Psbt({ network: networks.testnet });
  lastTx.setVersion(1);
  lastTx.addInput(p2shInput);
  lastTx.addOutput({ address: address, value: UTXO_VALUE });
  lastTx.addOutput({
    address: "EMJCKGLb6qapq2kcgNHgcbkwmSYFkMvcVt",
    value: nintondoFee,
  });

  const fee = weights.shift()!;

  const change = totalValue - fee - UTXO_VALUE - nintondoFee;
  if (change >= 1000)
    lastTx.addOutput({
      address,
      value: totalValue - fee - UTXO_VALUE - nintondoFee,
    });

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

  const finalizedTx = lastTx.extractTransaction(true);
  txs.push(finalizedTx.toHex());

  return txs;
}

export default inscribeWithWeights;
