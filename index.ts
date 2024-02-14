import fs from "fs";
import { IWallet, Inscription } from "./types";
import { AddressType, HDPrivateKey } from "bellhdw";
import Wallet from "./wallet";
import bip39 from "bip39";
import path from "path";
import inscribe from "./inscribe";
import { Psbt, Transaction, networks } from "belcoinjs-lib";
import { TEST_API } from "./consts";
import ECPair from "./ecpair";
import { calculateFeeForPsbt } from "./utils";

const WALLET_PATH = process.env.WALLET || ".wallet.json";
const CONTENT_TYPE = "image/jpg";
const PUSH_TX_PATH = "./tx-pusher/src/inscriptions.json";
const wallets: Wallet[] = [];
let feeRate: number = 4000;

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
          await splitWallets(
            Number.isNaN(Number(process.argv[4])) ? 2 : Number(process.argv[4])
          );
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
    case "send":
      await send(
        process.argv[3],
        Number(process.argv[4]),
        Number(process.argv[5]),
        process.argv[6]
      );
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
    txs.push((await wallet.splitUtxos(feeRate, utxoCount)) ?? "");
  }
  console.log(txs);
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
    CONTENT_TYPE,
    data,
    feeRate
  );
  let fee = 0;
  for (let tx of txs) {
    const transaction = Transaction.fromHex(tx);
    fee += transaction.toBuffer().length * feeRate;
  }
  // console.log(txs);
  console.log(`Total transactions: ${txs.length}`);
  console.log(`Fee costs: ${fee / 10 ** 8} BEL`);
  if (txs.length > 10) {
    const inscriptions: Inscription[] = await getToPushTxs(PUSH_TX_PATH);
    inscriptions.push({
      inscriptionNumber:
        (inscriptions[inscriptions.length - 1]?.inscriptionNumber ?? 0) + 1,
      txs: txs.map((f) => ({ pushed: false, txHex: f })),
    });
    fs.writeFileSync(PUSH_TX_PATH, JSON.stringify(inscriptions));
    console.log(
      "🫶🏻🫶🏻🫶🏻 There were to many transactions, so you gonna have to use rust code, GL!"
    );
  } else {
    await broadcastToTestnet(txs);
  }
}

async function broadcastToTestnet(txs: string[]) {
  for (const tx of txs) {
    const txid = await (
      await fetch(`${TEST_API}/tx`, {
        method: "POST",
        body: tx,
      })
    ).text();
    if (txid.length === 64) console.log(`✅ Inscription: ${txid}`);
    else {
      console.log(`❌ ${txid}`);
      console.log(`Failed to push hex:\n${tx}\n`);
    }
  }
}

async function send(
  toAddress: string,
  amount: number,
  walletIndex: number = 0,
  utxoTxid?: string
) {
  amount = 5000 * 10 ** 8;
  utxoTxid = "36f4c830cf53da4791538118eac5e5eaf6c58745458bb6a93ca63981228fdd1f";
  const wallet = wallets[walletIndex];
  const tx = new Psbt({ network: networks.bitcoin });
  if (utxoTxid) {
    const rawHex = await (await fetch(`${TEST_API}/tx/${utxoTxid}/hex`)).text();
    const utxo = wallet.utxos.find((x) => x.txid === utxoTxid);
    tx.addInput({
      hash: utxoTxid,
      index: utxo?.vout!,
      sequence: 0xfffffffe,
      nonWitnessUtxo: Buffer.from(rawHex, "hex"),
    });
  } else {
    // for (const utxo of wallet.utxos) {
    //   const rawHex = await (
    //     await fetch(`${TEST_API}/tx/${utxo.txid}/hex`)
    //   ).text();
    //   tx.addInput({
    //     hash: utxo.txid,
    //     index: utxo.vout,
    //     sequence: 0xfffffffe,
    //     nonWitnessUtxo: Buffer.from(rawHex, "hex"),
    //   });
    // }
  }

  tx.addOutput({
    address: "B8fPk8EweGHgAg8RK9yu8qooYbYhu5jKNK",
    value: amount,
  });
  const fee = calculateFeeForPsbt(
    tx.clone(),
    ECPair.fromWIF(wallet.toJson().secret),
    (psbt: Psbt) => {
      psbt.finalizeAllInputs();
    },
    feeRate,
    wallet.address
  );

  // const change =
  //   tx.txInputs.reduce(
  //     (acc, input) =>
  //       acc +
  //       wallet.utxos.find((f) => f.txid === input.hash.toString("hex"))?.value!,
  //     0
  //   ) -
  //   amount -
  //   fee;

  const change =
    wallet.utxos.find((x) => x.txid === utxoTxid)?.value! - amount - fee;

  console.log(`Fee: ${fee / 10 ** 8}`);
  console.log(`Change: ${change / 10 ** 8}`);
  tx.addOutput({ address: wallet.address, value: change });
  tx.signAllInputs(ECPair.fromWIF(wallet.toJson().secret));
  tx.finalizeAllInputs();
  const txHex = tx.extractTransaction(true).toHex();
  await broadcastToTestnet([txHex]);
}

async function getToPushTxs(path: string): Promise<Inscription[]> {
  if (fs.existsSync(path)) {
    const fileContent = fs.readFileSync(path).toString();
    if (fileContent.length === 0) return [];
    return JSON.parse(fileContent) as unknown as Inscription[];
  } else return [];
}

main().catch((e) => console.log(e));
