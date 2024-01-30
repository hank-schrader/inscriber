import { IWallet } from "./types";
import {
  Psbt,
  networks,
  script,
  crypto as belCrypto,
  opcodes,
} from "belcoinjs-lib";
import ECPair from "./ecpair";

const MAX_CHUNK_LEN = 240;

// async function inscribe(
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
//     OPS.OP_DUP,
//     OPS.OP_HASH160,
//     belCrypto.hash160(keyPair.publicKey),
//     OPS.OP_EQUALVERIFY,
//     OPS.OP_CHECKSIG,
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

async function inscribe(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  feeRate: number
): Promise<string[]> {
  const keyPair = ECPair.fromWIF(wallet.secret);
  let parts = [];

  // Split data into parts
  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(part);
  }

  let txs = []; // Array to hold the resulting transactions
  let lastLockScript; // Lock script of the previous transaction
  let lastTxId; // Transaction ID of the previous transaction

  for (let i = 0; i < parts.length; i++) {
    const psbt = new Psbt({ network: networks.bitcoin });
    (psbt as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
    psbt.setVersion(2);

    // Construct the inscription script for the current part
    let inscriptionChunks = [
      script.compile(Buffer.from("ord", "utf8")),
      script.number.encode(parts.length),
      script.compile(Buffer.from(contentType, "utf8")),
      script.number.encode(parts.length - i - 1),
      parts[i],
    ];

    // Calculate the transaction fee based on the estimated size
    let estimatedTxSize = 10; // overhead
    wallet.utxos.forEach(() => (estimatedTxSize += 148));
    estimatedTxSize += 34 * (i < parts.length - 1 ? 2 : 1);
    const fee = Math.ceil(feeRate * estimatedTxSize);

    // Construct the lock script for the current transaction
    const lockScript = script.compile([
      opcodes.OP_DUP,
      opcodes.OP_HASH160,
      script.compile(belCrypto.hash160(keyPair.publicKey)),
      opcodes.OP_EQUALVERIFY,
      opcodes.OP_CHECKSIG,
    ]);

    // Add inputs and outputs to the transaction
    let inputTotal = 0;
    for (const utxo of wallet.utxos) {
      psbt.addInput({
        hash: lastTxId || utxo.txid,
        index: lastTxId ? 0 : utxo.vout, // If lastTxId is set, the index should be 0, as it will be spending the first output (P2SH) from the last transaction
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: lastLockScript || lockScript,
          value: utxo.value,
        },
      });
      inputTotal += utxo.value;
    }

    const outputValue = inputTotal - fee;
    if (outputValue <= 0) {
      throw new Error(
        "Not enough funds to cover the fee and the amount to send"
      );
    }

    // Add the OP_RETURN output
    psbt.addOutput({
      script: script.compile([opcodes.OP_RETURN, ...inscriptionChunks]),
      value: 0,
    });

    // If this is not the last part, add a P2SH output for the next transaction
    if (i < parts.length - 1) {
      const nextLockScript = script.compile([
        opcodes.OP_DUP,
        opcodes.OP_HASH160,
        script.compile(belCrypto.hash160(keyPair.publicKey)),
        opcodes.OP_EQUALVERIFY,
        opcodes.OP_CHECKSIG,
      ]);
      const nextLockScriptHash = belCrypto.hash160(nextLockScript);
      const p2shScript = script.compile([
        opcodes.OP_HASH160,
        nextLockScriptHash,
        opcodes.OP_EQUAL,
      ]);
      psbt.addOutput({
        script: p2shScript,
        value: 100000, // P2SH output value for next transaction
      });
      lastLockScript = nextLockScript; // Save for the next iteration
    }

    // Add a change output only if there's change left after the P2SH output and fee
    if (outputValue > 100000) {
      psbt.addOutput({
        address: wallet.address,
        value: outputValue - 100000, // Deduct the value of the P2SH output
      });
    }

    // Sign all inputs
    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    // Extract the transaction and add it to the array
    const tx = psbt.extractTransaction();
    txs.push(tx);

    // Set up variables for the next iteration
    lastTxId = tx.getId(); // Save for the next iteration
  }

  // Serialize all transactions to hex and return them as an array
  const txHexes = txs.map((tx) => tx.toHex());
  return txHexes;
}

export default inscribe;
