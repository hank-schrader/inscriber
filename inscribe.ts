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

interface InscribeProps {
  wallet: IWallet;
  address: string;
  contentType: string;
  initialData: Buffer[];
  utxos: ApiUTXO[];
  weights: number[];
  requiredValue: number;
  utxoCount?: number;
}

function inscribeWithWeights({
  wallet,
  address,
  contentType,
  initialData,
  utxos,
  weights,
  requiredValue,
  utxoCount = 1,
}: InscribeProps): string[] {
  const txs: string[] = [];
  let nintondoFee = 1_000_000;
  const pair = ECPair.fromWIF(wallet.secret);

  const datas = initialData.sort((a, b) => a.length - b.length);

  if (!utxos.length) {
    const fakeValue = 99999999999999;
    let fakeTx = new Transaction();
    let fakeTxid = new Array(64).fill(0).join("");
    fakeTx.addInput(Buffer.from(fakeTxid, "hex"), 0);

    for (let i = 0; i < utxoCount; i++) {
      fakeTx.addOutput(
        payments.p2pkh({ pubkey: pair.publicKey, network: networks.testnet })
          .output!,
        fakeValue
      );
      utxos.push({
        hex: fakeTx.toHex(),
        value: fakeValue,
        txid: fakeTx.getId(),
        vout: i,
      });
    }
  }

  let parts: Buffer[][] = [];
  const inscriptions: Chunk[][] = [];

  let totalValue = requiredValue;

  for (let i = 0; i < datas.length; i++) {
    let data = datas[i];
    while (data.length) {
      let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
      data = data.slice(part.length);
      if (parts[i] === undefined) {
        parts[i] = [part];
      } else {
        parts[i].push(part);
      }
    }
  }

  for (let i = 0; i < parts.length; i++) {
    let currentPart = parts[i];
    inscriptions.push([
      bufferToChunk(Buffer.from("ord", "utf8")),
      numberToChunk(currentPart.length),
      bufferToChunk(Buffer.from(contentType, "utf8")),
      ...currentPart.flatMap((part, n) => [
        numberToChunk(currentPart.length - n - 1),
        bufferToChunk(part),
      ]),
    ]);
  }

  let p2shInputs: any[] = [];
  let lastLocks: any[] = [];
  let lastPartials: any[] = [];

  while (inscriptions.length) {
    let partials: Chunk[][] = [];
    const locks = [];
    let p2shInputCount = 0;

    const tx = new Psbt({ network: networks.testnet });
    tx.setVersion(1);

    let fee = weights.shift()!;
    totalValue -= fee;

    if (p2shInputs.length) {
      p2shInputs.forEach((input) => tx.addInput(input));
    }

    for (let i = 0; i < inscriptions.length; i++) {
      let inscription = inscriptions[i];
      if (!inscription.length) {
        inscriptions.splice(i, 1);
        i -= 1;

        tx.addOutput({ address: address, value: UTXO_VALUE });
        totalValue -= UTXO_VALUE;

        if (!inscriptions.length) {
          tx.addOutput({
            address: "EMJCKGLb6qapq2kcgNHgcbkwmSYFkMvcVt",
            value: nintondoFee,
          });
          const change =
            totalValue - nintondoFee - UTXO_VALUE * initialData.length;
          if (change >= 1000)
            tx.addOutput({
              address,
              value: change,
            });
        }
      } else {
        if (partials[i] === undefined) partials[i] = [];
        if (txs.length == 0) {
          partials[i].push(inscription.shift()!);
        }

        while (
          compile(partials[i]).length <= MAX_PAYLOAD_LEN &&
          inscription.length
        ) {
          if (partials[i] === undefined) {
            partials[i] = [inscription.shift()!, inscription.shift()!];
          } else {
            partials[i].push(inscription.shift()!);
            partials[i].push(inscription.shift()!);
          }
        }

        if (compile(partials[i]).length > MAX_PAYLOAD_LEN) {
          inscription.unshift(partials[i].pop()!);
          inscription.unshift(partials[i].pop()!);
        }

        const lock = compile([
          bufferToChunk(pair.publicKey),
          opcodeToChunk(opcodes.OP_CHECKSIGVERIFY),
          ...partials[i].map(() => opcodeToChunk(opcodes.OP_DROP)),
          opcodeToChunk(opcodes.OP_TRUE),
        ]);
        locks.push(lock);

        const lockHash = belCrypto.hash160(lock);

        const p2shScript = compile([
          opcodeToChunk(opcodes.OP_HASH160),
          bufferToChunk(lockHash),
          opcodeToChunk(opcodes.OP_EQUAL),
        ]);

        tx.addOutput({
          script: p2shScript,
          value:
            i + 1 === inscriptions.length
              ? totalValue - UTXO_VALUE * (inscriptions.length - 1)
              : UTXO_VALUE,
        });
        p2shInputCount += 1;
      }
    }

    if (!p2shInputs.length) {
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

    if (p2shInputs.length) {
      console.log(tx.data.inputs.filter((f) => f.partialSig?.length).length);
      tx.data.inputs.forEach((input, idx) => {
        const signature = input.partialSig![0].signature;

        const unlockScript = compile([
          ...lastPartials[idx],
          bufferToChunk(signature),
          bufferToChunk(lastLocks[idx]),
        ]);

        tx.finalizeInput(idx, () => {
          return {
            finalScriptSig: unlockScript,
            finalScriptWitness: undefined,
          };
        });
      });
    } else tx.finalizeAllInputs();

    txs.push(tx.extractTransaction(true).toHex());

    const transaction = tx.extractTransaction(true);

    nintondoFee += 100_000;

    p2shInputs = [];
    console.log(p2shInputCount);
    for (let i = 0; i < p2shInputCount; i++) {
      p2shInputs.push({
        hash: transaction.getId(),
        index: i,
        nonWitnessUtxo: transaction.toBuffer(),
        redeemScript: locks[i],
      });
    }
    lastPartials = partials;
    lastLocks = locks;
  }

  return txs;
}

export default inscribeWithWeights;
