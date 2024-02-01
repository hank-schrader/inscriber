import fs from "fs";
import { IWallet } from "./types";
import { AddressType, HDPrivateKey } from "bellhdw";
import Wallet from "./wallet";
import bip39 from "bip39";
import path from "path";
import inscribe from "./inscribe";
import { Transaction } from "belcoinjs-lib";

const WALLET_PATH = process.env.WALLET || ".wallet.json";
const wallets: Wallet[] = [];
let feeRate: number = 5000;

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
        case "sync":
          await syncWallets();
          break;
        case "split":
          await splitWallets(Number(process.argv[4]) ?? 2);
          break;
        default:
          console.log("Invalid command");
          break;
      }
      break;
    case "mint":
      if (process.argv.length < 5 && process.argv.length > 3) {
        console.log("Example: ");
        console.log("bun . mint token.json B7aGzxoUHgia1y8vRVP4EbaHkBNaasQieg");
      }
      await mint(process.argv[4], fs.readFileSync(process.argv[3]));
      break;
    case "inscribe":
      await inscribeWithCompileScript();
      break;
    case "broadcast":
      await broadcast(process.argv[3]);
      break;
    case "help":
      console.log("");
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

async function splitWallets(utxoCount: number) {
  const txs: string[] = [];
  for (const wallet of wallets) {
    txs.push((await wallet.splitUtxos(5000, 2)) ?? "");
  }
}

async function inscribeWithCompileScript() {
  const content_type = "application/json; charset=utf-8";
  const data: Buffer = fs.readFileSync(wallets[0].photoPath!);
  const toAddress = "BRXknAc5gRVSh6Yo3Gs8hgwRPa3mumBwcm";

  const txs = await inscribe(
    wallets[0].toJson(),
    toAddress,
    content_type,
    data,
    5000
  );
  console.log(txs);
}

async function broadcast(tx: string) {
  const body = {
    jsonrpc: "1.0",
    id: 0,
    method: "sendrawtransaction",
    params: [tx.toString()],
  };

  const options = {
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.NODE_RPC_USER}:${process.env.NODE_RPC_PASS}`
        ).toString("base64"),
    },
  };

  fetch(process.env.NODE_RPC_URL!, {
    method: "POST",
    body: JSON.stringify(body),
    headers: options.headers,
  })
    .then((response) => response.json())
    .then((data) => console.log(data))
    .catch((error) => console.error("Error:", error));
}

async function mint(toAddress: string, data: Buffer) {
  const txs = await inscribe(
    wallets[0].toJson(),
    toAddress,
    "application/json; charset=utf-8",
    data,
    feeRate
  );
  let fee = 0;
  for (let tx of txs) {
    const transaction = Transaction.fromHex(tx);
    fee += transaction.toBuffer().length * 10000;
  }
  console.log(`Total transactions: ${txs.length}`);
  console.log(`Fee costs: ${fee / 10 ** 8}`);
}

main().catch((e) => console.log(e));
