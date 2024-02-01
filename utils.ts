import { ApiUTXO, ICalculateFeeForPsbtWithManyOutputs, IWallet } from "./types";
import {
  Psbt,
  networks,
  script as belScript,
  crypto as belCrypto,
  opcodes,
  Transaction,
  payments,
} from "belcoinjs-lib";
import ECPair from "./ecpair";

export async function getHexes(utxos: ApiUTXO[]): Promise<string[]> {
  const hexes = [];
  for (const utxo of utxos) {
    const hex = await (
      await fetch(`https://api.nintondo.io/api/tx/${utxo.txid}/hex`)
    ).text();
    // const hex = await (
    //   await fetch(`http://192.168.0.102:3001/tx/${utxo.txid}/hex`)
    // ).text();
    hexes.push(hex);
  }
  return hexes;
}

export function calculateFeeForPsbt(
  psbt: Psbt,
  pair: any,
  finalizeMethod: (psbt: Psbt) => void,
  feeRate: number
): number {
  psbt.signAllInputs(pair);
  finalizeMethod(psbt);
  let txSize = psbt.extractTransaction(true).toBuffer().length;
  const fee = Math.ceil(txSize * feeRate);
  return fee;
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

export function calculateFeeForLastTx({
  psbt,
  feeRate,
  pair,
  lastPartial,
  lastLock,
}: {
  psbt: Psbt;
  feeRate: number;
  pair: any;
  lastPartial: Buffer[];
  lastLock: Buffer;
}): number {
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
