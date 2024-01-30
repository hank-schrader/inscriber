import { ApiUTXO, IWallet } from "./types";
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
import { resolve } from "bun";

const MAX_CHUNK_LEN = 240;
const MAX_PAYLOAD_LEN = 1500;
// async function shit_inscribe(
//   wallet: IWallet,
//   address: string,
//   contentType: string,
//   data: Buffer,
//   feeRate: number
// ): Promise<string> {
//   const keyPair = ECPair.fromWIF(wallet.secret);
//   let parts = [];

//   while (data.length) {
//     let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
//     data = data.slice(part.length);
//     parts.push(part);
//   }

//   let inscription = script.compile([
//     Buffer.from("ord", "utf8"),
//     script.number.encode(parts.length),
//     Buffer.from(contentType, "utf8"),
//     ...parts.flatMap((part, n) => [
//       script.number.encode(parts.length - n - 1),
//       part,
//     ]),
//   ]);

//   const psbt = new Psbt({ network: networks.bitcoin });
//   (psbt as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
//   psbt.setVersion(2);

//   let estimatedTxSize = inscription.length + 10;
//   wallet.utxos.forEach(() => (estimatedTxSize += 148)); // 148 bytes per P2PKH input
//   estimatedTxSize += 34 * 2;
//   const fee = Math.ceil(feeRate * estimatedTxSize);

//   const lockScript = script.compile([
//     opcodes.OP_DUP,
//     opcodes.OP_HASH160,
//     belCrypto.hash160(keyPair.publicKey),
//     opcodes.OP_EQUALVERIFY,
//     opcodes.OP_CHECKSIG,
//   ]);

//   // Add the UTXOs as inputs
//   for (const utxo of wallet.utxos) {
//     psbt.addInput({
//       hash: utxo.txid,
//       index: utxo.vout,
//       sequence: 0xfffffffe, // Enable RBF with maxint-1 sequence
//       witnessUtxo: {
//         script: lockScript,
//         value: utxo.value,
//       },
//     });
//     estimatedTxSize += 107; // Add size for the input script
//   }

//   // Calculate the change to send back to the wallet
//   const totalUtxoValue = wallet.utxos.reduce(
//     (acc, utxo) => acc + utxo.value,
//     0
//   );
//   const changeValue = totalUtxoValue - fee - 100000;
//   if (changeValue < 0) {
//     throw new Error("Not enough funds to cover the fee and the amount to send");
//   }

//   // Add outputs to the transaction
//   psbt.addOutput({
//     script: inscription,
//     value: 0,
//   });
//   psbt.addOutput({
//     address: address,
//     value: 100000,
//   });
//   if (changeValue > 0) {
//     psbt.addOutput({
//       address: wallet.address,
//       value: changeValue,
//     });
//   }

//   psbt.signAllInputs(keyPair);
//   psbt.finalizeAllInputs();
//   const txHex = psbt.extractTransaction().toHex();

//   return txHex;
// }

async function getHexes(utxos: ApiUTXO[]): Promise<string[]> {
  const hexes = [];
  for (const utxo of utxos) {
    const hex = await (
      await fetch(`https://api.nintondo.io/api/tx/${utxo.txid}/hex`)
    ).text();
    hexes.push(hex);
  }
  return hexes;
}

async function inscribe(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  feeRate: number
) {
  let keyPair = ECPair.fromWIF(wallet.secret, networks.bitcoin);
  let publicKey = keyPair.publicKey;

  let parts: Buffer[] = []; // Explicitly type parts as an array of Buffer
  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(Buffer.from(part)); // Convert part to Buffer before pushing
  }

  let inscription = belScript.compile([
    Buffer.from("ord", "utf8"),
    belScript.number.encode(parts.length),
    Buffer.from(contentType, "utf8"),
    ...parts.flatMap((part, n) => [
      belScript.number.encode(parts.length - n - 1),
      part,
    ]),
  ]);

  let lastPartial = Buffer.alloc(0);

  while (lastPartial.length <= MAX_PAYLOAD_LEN && inscription.length > 0) {
    lastPartial = Buffer.concat([lastPartial, inscription.slice(0, 2)]);
    inscription = inscription.slice(2);
  }

  if (lastPartial.length > MAX_PAYLOAD_LEN) {
    inscription = Buffer.concat([lastPartial.slice(-2), inscription]);
    lastPartial = lastPartial.slice(0, -2);
  }

  let p2sh = payments.p2sh({
    redeem: {
      output: belScript.compile([
        publicKey,
        opcodes.OP_CHECKSIGVERIFY,
        ...Array.from(
          { length: lastPartial.length / 2 },
          () => opcodes.OP_DROP
        ),
        opcodes.OP_TRUE,
      ]),
    },
    network: networks.bitcoin,
  });

  const psbt = new Psbt({ network: networks.bitcoin });

  const hexes = await getHexes(wallet.utxos);
  wallet.utxos.forEach((utxo, i) => {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(hexes[i], "hex"),
    });
  });

  let inputAmount = wallet.utxos.reduce((acc, utxo) => acc + utxo.value, 0);
  let fee = 1000000; // Placeholder fee calculation
  if (inputAmount < 100000 + fee) {
    throw new Error("not enough funds");
  }
  psbt.addOutput({
    address: p2sh.address!,
    value: 100000,
  });
  if (inputAmount - 100000 - fee > 0)
    psbt.addOutput({
      address: wallet.address,
      value: inputAmount - 100000 - fee,
    });

  wallet.utxos.forEach((utxo, i) => {
    psbt.signInput(i, keyPair);
  });

  psbt.finalizeAllInputs();

  let p2shInputTx = psbt.extractTransaction();
  const p2shInputData = {
    hash: p2shInputTx.getId(),
    index: 0,
    nonWitnessUtxo: Buffer.from(p2shInputTx.toBuffer()),
    redeemScript: p2sh.redeem!.output!,
  };

  let psbt2 = new Psbt({ network: networks.bitcoin })
    .addInput(p2shInputData)
    .addOutput({
      address: wallet.address,
      value: 100000,
    });

  for (const utxo of wallet.utxos) {
    let inputAmount = 0;
    for (const input of psbt2.data.inputs) {
      inputAmount += input.witnessUtxo ? input.witnessUtxo.value : 0;
    }
    let outputAmount = psbt2.data.outputs.reduce(
      (acc, output) => acc + 100000,
      0
    );
    // let fee = psbt2.getFee();
    let fee = 100000 + 1000000;

    if (inputAmount >= outputAmount + fee) {
      break;
    }

    psbt2.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(hexes[wallet.utxos.indexOf(utxo)], "hex"),
    });

    psbt2.addOutput({
      address: wallet.address,
      value: utxo.value,
    });
  }

  psbt2.signInput(0, keyPair);
  psbt2.signInput(1, keyPair);
  psbt2.finalizeInput(
    0,
    (inputIndex, input, script, isSegwit, isP2SH, isP2WSH) => {
      //None witness p2pkh address
      let signature = psbt2.data.inputs[inputIndex].partialSig![0].signature;
      let redeemScript = script;
      let finalScriptSig = undefined;

      finalScriptSig = belScript.compile([signature, redeemScript]);
      return {
        finalScriptSig,
        finalScriptWitness: undefined,
      };
    }
  );
  psbt2.finalizeInput(1);

  const lastTx = psbt2.extractTransaction();
  console.log([p2shInputTx.toHex(), lastTx.toHex()]);
  //   const lastPsbt = new Psbt({ network: networks.bitcoin });
  //   (lastPsbt as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
  //   lastPsbt.addInput({
  //     hash: p2shInputTx.getId(),
  //     index: 0,
  //     witnessUtxo: {
  //       script: p2sh.output!,
  //       value: 100000,
  //     },
  //     redeemScript: p2sh.redeem!.output,
  //   });
  //   lastPsbt.addOutput({
  //     address: address,
  //     value: 100000,
  //   });
  //   fee = 10000;
  //   if (inputAmount - 100000 - fee > 0)
  //     lastPsbt.addOutput({
  //       address: wallet.address,
  //       value: inputAmount - 100000 - fee,
  //     });

  //   lastPsbt.signInput(0, keyPair);
  //   //   lastPsbt.finalizeInput(0);
  //   //   lastPsbt.finalizeAllInputs();
  //   lastPsbt.finalizeInput(0, (_: any, input: any, script: any) => {
  //     const transaction = lastPsbt.extractTransaction();
  //     const sighashType = Transaction.SIGHASH_ALL;
  //     const signatureHash = transaction.hashForWitnessV0(
  //       0,
  //       p2sh.redeem!.output!,
  //       input.witnessUtxo!.value,
  //       sighashType
  //     );
  //     const signature = keyPair.sign(signatureHash);
  //     const signatureScript = script.signature.encode(signature, sighashType);

  //     return {
  //       finalScriptSig: script.compile([signatureScript, publicKey]),
  //       finalScriptWitness: undefined,
  //     };
  //   });

  //   let lastBuiltTx = lastPsbt.extractTransaction();

  // Update wallet with the new transaction details if needed
  // updateWallet(wallet, lastBuiltTx);

  // return [p2shInputTx, lastBuiltTx];
}

// function calculateFee(inscription: Buffer, wallet: IWallet, feeRate: number) {
//   let estimatedTxSize = inscription.length + 10;
//   wallet.utxos.forEach(() => (estimatedTxSize += 148));
//   estimatedTxSize += 34 * 2;
//   const fee = Math.ceil(feeRate * estimatedTxSize);
//   const totalUtxoValue = wallet.utxos.reduce(
//     (acc, utxo) => acc + utxo.value,
//     0
//   );
//   const changeValue = totalUtxoValue - fee - 100000;
//   if (changeValue < 0) {
//     throw new Error("Not enough funds to cover the fee and the amount to send");
//   }
//   return { changeValue, estimatedTxSize };
// }

// async function inscribe(
//   wallet: IWallet,
//   address: string,
//   contentType: string,
//   data: Buffer,
//   feeRate: number
// ): Promise<string[]> {
//   const pair = ECPair.fromWIF(wallet.secret);
//   let parts = [];
//   const txs: string[] = [];

//   while (data.length) {
//     let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
//     data = data.slice(part.length);
//     parts.push(part);
//   }

//   const inscription = [
//     Buffer.from("ord", "utf8"),
//     script.number.encode(parts.length),
//     Buffer.from(contentType, "utf8"),
//     ...parts.flatMap((part, n) => [
//       script.number.encode(parts.length - n - 1),
//       part,
//     ]),
//   ];

//   let p2shInput: any | undefined = undefined;
//   let lastLock: any | undefined = undefined;
//   let lastPartial: any | undefined = undefined;

//   while (inscription.length) {
//     let partial: Buffer[] = [];

//     if (txs.length == 0) {
//       partial.push(inscription.shift() as Buffer);
//     }

//     while (
//       script.compile(partial).length <= MAX_PAYLOAD_LEN &&
//       inscription.length
//     ) {
//       partial.push(inscription.shift()!);
//       partial.push(inscription.shift()!);
//     }

//     if (script.compile(partial).length > MAX_PAYLOAD_LEN) {
//       inscription.unshift(partial.pop()!);
//       inscription.unshift(partial.pop()!);
//     }

//     const lock = script.compile([
//       pair.publicKey,
//       script.number.encode(opcodes.OP_CHECKSIGVERIFY),
//       ...partial.map(() => script.number.encode(opcodes.OP_DROP)),
//       script.number.encode(opcodes.OP_TRUE),
//     ]);

//     const redeemScriptHash = belCrypto.hash160(lock);

//     const p2shScript = script.compile([
//       opcodes.OP_HASH160,
//       redeemScriptHash,
//       opcodes.OP_EQUAL,
//     ]);

//     const p2shOutput = {
//       script: p2shScript,
//       value: 100000,
//     };

//     const tx = new Psbt({ network: networks.bitcoin });
//     (tx as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
//     tx.setVersion(2);

//     let { changeValue, estimatedTxSize } = calculateFee(
//       script.compile(inscription),
//       wallet,
//       feeRate
//     );

//     if (p2shInput) tx.addInput(p2shInput);
//     tx.addOutput(p2shOutput);
//     tx.addOutput({
//       address: wallet.address,
//       value: changeValue,
//     });

//     for (const utxo of wallet.utxos) {
//       tx.addInput({
//         hash: utxo.txid,
//         index: utxo.vout,
//         sequence: 0xfffffffe,
//         witnessUtxo: {
//           script: pair.publicKey,
//           value: utxo.value,
//         },
//       });
//       estimatedTxSize += 107;
//     }

//     lastPartial = partial;
//     lastLock = lock;

//     tx.signInput(0, pair);
//     tx.signAllInputs(pair);
//     tx.finalizeAllInputs();
//     txs.push(tx.extractTransaction().toHex());
//   }

//   return txs;
// }
export default inscribe;
