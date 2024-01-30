import { IWallet } from "./types";
import {
  Psbt,
  networks,
  script as belScript,
  crypto as belCrypto,
  payments,
} from "belcoinjs-lib";
import ECPair from "./ecpair";
import { OPS } from "belcoinjs-lib/src/ops";
import { p2pkh } from "belcoinjs-lib/src/payments";

const MAX_CHUNK_LEN = 240;

async function inscribe(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  feeRate: number
): Promise<string> {
  const keyPair = ECPair.fromWIF(wallet.secret);
  let parts = [];

  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(part);
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

  const psbt = new Psbt({ network: networks.bitcoin });
  (psbt as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;
  psbt.setVersion(2); // Use version 2 to enable time locks if needed

  // Calculate fee for the transaction
  let estimatedTxSize = inscription.length + 10; // 10 bytes for overhead
  wallet.utxos.forEach(() => (estimatedTxSize += 148)); // 148 bytes per P2PKH input
  estimatedTxSize += 34 * 2; // 34 bytes per output (P2PKH)
  const fee = Math.ceil(feeRate * estimatedTxSize);

  // Create a lock script with a public key and OP_CHECKSIG
  const lockScript = belScript.compile([
    OPS.OP_DUP,
    OPS.OP_HASH160,
    belCrypto.hash160(keyPair.publicKey),
    OPS.OP_EQUALVERIFY,
    OPS.OP_CHECKSIG,
  ]);

  // Add the UTXOs as inputs
  for (const utxo of wallet.utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: 0xfffffffe, // Enable RBF with maxint-1 sequence
      witnessUtxo: {
        script: lockScript,
        value: utxo.value,
      },
    });
    estimatedTxSize += 107; // Add size for the input script
  }

  // Calculate the change to send back to the wallet
  const totalUtxoValue = wallet.utxos.reduce(
    (acc, utxo) => acc + utxo.value,
    0
  );
  const changeValue = totalUtxoValue - fee - 100000;
  if (changeValue < 0) {
    throw new Error("Not enough funds to cover the fee and the amount to send");
  }

  // Add outputs to the transaction
  psbt.addOutput({
    script: inscription,
    value: 0,
  });
  psbt.addOutput({
    address: address,
    value: 100000,
  });
  if (changeValue > 0) {
    psbt.addOutput({
      address: wallet.address,
      value: changeValue,
    });
  }

  // Sign all inputs with the private key
  psbt.signAllInputs(keyPair);

  // Finalize all inputs
  psbt.finalizeAllInputs();

  // Extract the transaction hex
  const txHex = psbt.extractTransaction().toHex();

  return txHex;
}

export default inscribe;
