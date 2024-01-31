import { IWallet } from "./types";
import {
  Psbt,
  networks,
  script as belScript,
  crypto as belCrypto,
  opcodes,
  Transaction,
} from "belcoinjs-lib";
import ECPair from "./ecpair";
import { calculateFeeForLastTx, calculateFeeForPsbt, getHexes } from "./utils";

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

  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(part);
  }

  const inscription = [
    Buffer.from("ord", "utf8"),
    belScript.number.encode(parts.length),
    Buffer.from(contentType, "utf8"),
    ...parts.flatMap((part, n) => [
      belScript.number.encode(parts.length - n - 1),
      part,
    ]),
  ];

  let p2shInput: any | undefined = undefined;
  let lastLock: any | undefined = undefined;
  let lastPartial: any | undefined = undefined;

  while (inscription.length) {
    let partial: Buffer[] = [];

    if (txs.length == 0) {
      partial.push(inscription.shift() as Buffer);
    }

    while (
      belScript.compile(partial).length <= MAX_PAYLOAD_LEN &&
      inscription.length
    ) {
      partial.push(inscription.shift()!);
      partial.push(inscription.shift()!);
    }

    if (belScript.compile(partial).length > MAX_PAYLOAD_LEN) {
      inscription.unshift(partial.pop()!);
      inscription.unshift(partial.pop()!);
    }

    const lock = belScript.compile([
      pair.publicKey,
      belScript.number.encode(opcodes.OP_CHECKSIGVERIFY),
      ...partial.map(() => belScript.number.encode(opcodes.OP_DROP)),
      belScript.number.encode(opcodes.OP_TRUE),
    ]);

    const redeemScriptHash = belCrypto.hash160(lock);

    const p2shScript = belScript.compile([
      opcodes.OP_HASH160,
      redeemScriptHash,
      opcodes.OP_EQUAL,
    ]);

    const p2shOutput = {
      script: p2shScript,
      value: 100000,
    };

    const tx = new Psbt({ network: networks.bitcoin });

    if (p2shInput) tx.addInput(p2shInput);
    tx.addOutput(p2shOutput);

    tx.addInput({
      hash: utxos[0].txid,
      index: utxos[0].vout,
      sequence: 0xfffffffe,
      nonWitnessUtxo: Buffer.from(hexes[0], "hex"),
    });

    const fee = calculateFeeForPsbt(
      tx.clone(),
      pair,
      (psbt) => {
        return psbt.finalizeAllInputs();
      },
      feeRate
    );

    const change = utxos[0].value - fee - 100000;
    if (change <= 0) throw new Error("Insufficient funds");
    else tx.addOutput({ address: wallet.address, value: change });

    utxos.shift();
    hexes.shift();

    tx.signAllInputs(pair);
    tx.finalizeAllInputs();
    txs.push(tx.extractTransaction().toHex());

    const transaction = tx.extractTransaction();
    p2shInput = {
      hash: transaction.getId(),
      index: 0,
      nonWitnessUtxo: transaction.toBuffer(),
      redeemScript: lock,
      value: p2shOutput.value,
    };
    lastPartial = partial;
    lastLock = lock;
  }

  const lastTx = new Psbt({ network: networks.bitcoin });
  lastTx.addInput(p2shInput);
  lastTx.addInput({
    hash: utxos[0].txid,
    index: utxos[0].vout,
    sequence: 0xfffffffe,
    nonWitnessUtxo: Buffer.from(hexes[0], "hex"),
  });
  lastTx.addOutput({ address: address, value: 100000 });

  const fee = calculateFeeForLastTx({
    feeRate,
    pair,
    psbt: lastTx.clone(),
    lastPartial,
    lastLock,
  });

  const change = utxos[0].value - fee - 100000;
  if (change <= 0) throw new Error("Insufficient funds");
  else lastTx.addOutput({ address: wallet.address, value: change });

  lastTx.signAllInputs(pair);

  const sighashType = Transaction.SIGHASH_ALL;
  const signature = lastTx.data.inputs[0].partialSig![0].signature;
  const signatureWithHashType = Buffer.concat([
    signature,
    belScript.number.encode(sighashType),
  ]);

  const unlockScript = belScript.compile([
    ...lastPartial,
    signatureWithHashType,
    lastLock,
  ]);

  lastTx.finalizeInput(0, (_: any, input: any, script: any) => {
    return {
      finalScriptSig: unlockScript,
      finalScriptWitness: undefined,
    };
  });
  lastTx.finalizeInput(1);

  const finalizedTx = lastTx.extractTransaction();
  txs.push(finalizedTx.toHex());

  return txs;
}
export default inscribe;
