import fs from "fs";
import { IWallet } from "./types";
import { AddressType, HDPrivateKey } from "bellhdw";
import Wallet from "./wallet";
import bip39 from "bip39";
import path from "path";
import { Psbt, networks, payments, script } from "belcoinjs-lib";
import ECPair from "./ecpair";
import { OPS } from "belcoinjs-lib/src/ops";

const WALLET_PATH = process.env.WALLET || ".wallet.json";
const wallets: Wallet[] = [];
const MAX_CHUNK_LEN = 120;
// let feeRate: number | undefined = undefined;

async function main() {
  await initWallets(WALLET_PATH);
  switch (process.argv[2]) {
    case "wallet":
      switch (process.argv[3]) {
        case "new":
          if (process.argv[4] === "for") {
            createWalletsForPhotos(process.argv[5] ?? "");
            break;
          }
          await createWallet(
            Number.isNaN(Number(process.argv[4])) ? 1 : Number(process.argv[4])
          );
          break;
        case "import":
          await importWallet(process.argv[4]);
          break;
        case "fee":
          // await calculateFee();
          break;
        case "sync":
          await syncWallets();
          break;
        default:
          console.log("Invalid command");
          break;
      }
      break;
    case "mint":
      switch (process.argv[3]) {
        case "token":
          //   await mintToken();
          break;
        default:
          console.log("Invalid command");
      }
      break;
    case "inscribe":
      await inscribeWithCompileScript();
      break;
    default:
      console.log("Invalid command");
  }
}

async function initWallets(path: string) {
  if (fs.existsSync(path)) {
    const fileContent = fs.readFileSync(path).toString();
    if (fileContent.length === 0) return;
    wallets.push(
      ...JSON.parse(fileContent).map((x: IWallet) => {
        return Wallet.deserialize({
          addressType: AddressType.P2PKH,
          privateKey: x.secret,
          address: x.address,
          balance: x.balance,
          utxos: x.utxos,
          photoPath: x.photoPath,
        });
      })
    );
  }
}

async function saveWallets(path: string) {
  console.log(wallets.map((x) => x.toJson().utxos));
  console.log(JSON.stringify(wallets.map((x) => x.toJson())));
  fs.writeFileSync(path, JSON.stringify(wallets.map((x) => x.toJson())));
}

async function createWallet(count: number, photos?: string[]) {
  for (let i = 0; i < count; i++) {
    const mnemonic = bip39.generateMnemonic();
    const rootWallet = await HDPrivateKey.fromMnemonic({
      mnemonic,
      addressType: AddressType.P2PKH,
      hideRoot: true,
    });
    const address = rootWallet.addAccounts(1)[0];
    const privateKey = rootWallet.exportAccount(address);
    const wallet = Wallet.deserialize({
      privateKey: privateKey,
      addressType: AddressType.P2PKH,
      isHex: false,
      photoPath: photos?.[i],
    });
    wallets.push(wallet);
    await saveWallets(WALLET_PATH);
  }
}

async function syncWallets() {
  for (const wallet of wallets) {
    await wallet.sync();
  }
  await saveWallets(WALLET_PATH);
}

async function importWallet(secret: string) {
  const wallet = Wallet.deserialize({
    privateKey: secret,
    addressType: AddressType.P2PKH,
    isHex: false,
    fundWallet: true,
  });
  wallets.push(wallet);
  await saveWallets(WALLET_PATH);
}

async function createWalletsForPhotos(folderName: string) {
  const paths = await new Promise<string[]>((resolve, reject) => {
    fs.readdir(folderName, (err, files) => {
      if (err) {
        reject(err);
      } else {
        const photoPaths = files
          .filter((file) => path.extname(file).toLowerCase() === ".json")
          .map((file) => path.join(folderName, file));
        resolve(photoPaths);
      }
    });
  });
  let photoIndex: number | undefined = undefined;
  wallets.map((wallet) => {
    if (wallet.photoPath === undefined || !wallet.fundWallet) {
      wallet.photoPath = paths[photoIndex ?? 0];
      photoIndex = photoIndex === undefined ? 1 : photoIndex + 1;
      return wallet;
    }
  });
  if (photoIndex !== undefined) {
    paths.splice(0, photoIndex);
  }
  await createWallet(paths.length, paths);
  if (paths.length <= 0) await saveWallets(WALLET_PATH);
}

async function inscribeWithCompileScript() {
  const content_type = "application/json; charset=utf-8";
  const data: Buffer = fs.readFileSync(wallets[0].photoPath!);
  const toAddress = "B8fPk8EweGHgAg8RK9yu8qooYbYhu5jKNK";

  const txs = await inscribe(
    wallets[0].toJson(),
    toAddress,
    content_type,
    data,
    5000
  );
  console.log(txs);
}

async function inscribe(
  wallet: IWallet,
  address: string,
  contentType: string,
  data: Buffer,
  feeRate: number // fee rate in satoshis per byte
): Promise<string> {
  const keyPair = ECPair.fromWIF(wallet.secret);

  let parts: Buffer[] = [];
  while (data.length) {
    let part = data.slice(0, Math.min(MAX_CHUNK_LEN, data.length));
    data = data.slice(part.length);
    parts.push(part);
  }

  let inscription = script.compile([
    Buffer.from("ord", "utf8"),
    OPS.OP_PUSHDATA1,
    Buffer.from([parts.length]),
    Buffer.from(contentType, "utf8"),
  ]);

  parts.forEach((part, n) => {
    inscription = Buffer.concat([
      inscription,
      Buffer.from([OPS.OP_PUSHDATA1]),
      Buffer.from([parts.length - n - 1]),
      part,
    ]);
  });

  const psbt = new Psbt({ network: networks.bitcoin });
  (psbt as any).__CACHE.__UNSAFE_SIGN_NONSEGWIT = true;

  for (const utxo of wallet.utxos) {
    const p2pkhOutputScript = payments.p2pkh({
      pubkey: keyPair.publicKey,
      network: networks.bitcoin,
    }).output;

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        value: utxo.value,
        script: p2pkhOutputScript!,
      },
    });

    psbt.setInputSequence(
      wallet.utxos.findIndex((f) => f.txid === utxo.txid),
      0xfffffffd
    );
  }

  const estimatedTxSize =
    psbt.data.globalMap.unsignedTx.toBuffer().length +
    107 * wallet.utxos.length +
    (inscription.length + 34) +
    10;
  const fee = Math.ceil(feeRate * estimatedTxSize);

  let totalUtxoValue = wallet.utxos.reduce((acc, utxo) => acc + utxo.value, 0);
  let changeValue = totalUtxoValue - fee - 100000;

  if (changeValue < 0) {
    throw new Error("Not enough funds to cover the fee and inscription value");
  }

  if (changeValue > 0) {
    psbt.addOutput({
      address: wallet.address,
      value: changeValue,
    });
  }

  psbt.addOutput({
    script: inscription,
    value: 100000,
    address: address,
  });

  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  let tx = psbt.extractTransaction();
  return tx.toHex();
}

main().catch((e) => console.log(e));
