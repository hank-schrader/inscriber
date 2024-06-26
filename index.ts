import fs from "fs";
import { ApiOrdUTXO, ApiUTXO, IWallet, Inscription } from "./types";
import { AddressType, HDPrivateKey } from "bellhdw";
import Wallet from "./wallet";
import bip39 from "bip39";
import path from "path";
import inscribe from "./inscribe";
import { Psbt, Transaction, networks } from "belcoinjs-lib";
import { ELECTRS_API } from "./consts";
import ECPair from "./ecpair";
import { calculateFeeForPsbt, getHexes, gptFeeCalculate } from "./utils";

const WALLET_PATH = process.env.WALLET || ".wallet.json";
const CONTENT_TYPE = "application/json; charset=utf-8";
// const CONTENT_TYPE = "model/stl";
// const CONTENT_TYPE = "model/gltf-binary";
const PUSH_TX_PATH = "./tx-pusher/inscriptions.json";
const wallets: Wallet[] = [];
let feeRate: number = 200;

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
    case "shit":
      do_some_shit();
      break;
    case "undo":
      undo_some_shit();
      break;
    case "burn":
      burn_inscription();
      break;
    case "one":
      makeOneUtxo();
      break;
    case "fund":
      fund_wallets();
      break;
    case "big_one":
      inscribe_everything();
      break;
    case "shitt":
      make_a_lot_of_shit();
      break;
    case "ord_sex":
      send_all_ords_to_ieg();
      break;
    case "sum":
      calcOrdsSumForAddress();
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
          fundWallet: x.fundWallet,
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

async function inscribe_everything() {
  for (const wallet of wallets) {
    if (wallet.photoPath !== undefined) {
      const txs = await inscribe(
        wallet.toJson(),
        "BKM3BwCFaguCNMg3Bv5BNm1LLttQro9EDA",
        CONTENT_TYPE,
        fs.readFileSync(wallet.photoPath),
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
      if (txs.length > 20) {
        const inscriptions: Inscription[] = await getToPushTxs(PUSH_TX_PATH);
        inscriptions.push({
          inscriptionNumber:
            (inscriptions[inscriptions.length - 1]?.inscriptionNumber ?? 0) + 1,
          txs: txs.map((f) => ({ pushed: false, txHex: f })),
        });
        fs.writeFileSync(PUSH_TX_PATH, JSON.stringify(inscriptions));
        console.log(
          "🫶🫶🫶 There were to many transactions, so you gonna have to use rust code, GL!"
        );
      } else {
        await broadcastToTestnet(txs);
      }
    }
  }
}

async function fund_wallets() {
  const psbt = new Psbt({ network: networks.testnet });
  let fund = 0;
  let expenses = 0;
  const fundWallet = wallets.find((f) => f.fundWallet);
  if (fundWallet === undefined)
    return console.log("COULD NOT FIND ANY FUND WALLET");
  for (const [f, utxo] of fundWallet.utxos.entries()) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from((await getHexes([utxo]))[0], "hex"),
    });
    fund += utxo.value;
  }
  for (const [i, wallet] of wallets.entries()) {
    if (!wallet.fundWallet) {
      psbt.addOutput({
        address: wallet.address,
        value: 10 * 10 ** 8,
      });
      expenses += 10 * 10 ** 8;
    }
  }
  if (expenses > fund) return console.log("NOT ENOUGH FUNDS");

  psbt.addOutput({
    address: fundWallet.address,
    value:
      fund -
      expenses -
      gptFeeCalculate(psbt.txInputs.length, psbt.txOutputs.length + 1, 400),
  });

  fundWallet.signAllInputsInPsbt(psbt, "");
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
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
          .filter((file) => path.extname(file).toLowerCase() === ".webp")
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
  const data: Buffer = fs.readFileSync(wallets[0].photoPath!);
  const toAddress = "BRXknAc5gRVSh6Yo3Gs8hgwRPa3mumBwcm";

  const txs = await inscribe(
    wallets[0].toJson(),
    toAddress,
    CONTENT_TYPE,
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
      "🫶🫶🫶 There were to many transactions, so you gonna have to use rust code, GL!"
    );
  } else {
    await broadcastToTestnet(txs);
  }
}

async function broadcastToTestnet(txs: string[]) {
  for (const tx of txs) {
    const txid = await (
      await fetch(`${ELECTRS_API}/tx`, {
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
  const tx = new Psbt({ network: networks.testnet });
  if (utxoTxid) {
    const rawHex = await (
      await fetch(`${ELECTRS_API}/tx/${utxoTxid}/hex`)
    ).text();
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
    //     await fetch(`${ELECTRS_API}/tx/${utxo.txid}/hex`)
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

async function do_some_shit() {
  const wallet = wallets.find((f) => f.fundWallet);
  if (!wallet) return;
  let ordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/ords`)
  ).json()) as ApiOrdUTXO[];
  const hexes = await getHexes(ordUtxos);
  ordUtxos.forEach((f, i) => {
    f.rawHex = hexes[i];
  });
  ordUtxos = ordUtxos.splice(0, 2);

  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];
  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });

  const psbt = new Psbt({ network: networks.testnet });
  for (let i of ordUtxos) {
    if (
      !psbt.txInputs.find(
        (f) => f.hash.reverse().toString("hex") === i.txid && f.index === i.vout
      )
    )
      psbt.addInput({
        hash: i.txid,
        index: i.vout,
        nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
      });
  }

  for (let i of nonordUtxos) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }

  psbt.addOutput({
    address: wallet.address,
    value: 45329,
  });

  psbt.addOutput({
    address: wallet.address,
    value: ordUtxos.reduce((acc, val) => (acc += val.value), 0) + 2000,
  });

  const fee = gptFeeCalculate(ordUtxos.length + nonordUtxos.length, 2, 100);
  console.log(`FEE: ${fee / 10 ** 8}`);

  psbt.addOutput({
    address: wallet.address,
    value:
      nonordUtxos.reduce((acc, val) => (acc += val.value), 0) -
      fee -
      2000 -
      45329,
  });
  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

async function undo_some_shit() {
  const wallet = wallets[0];
  const ordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/ords`)
  ).json()) as ApiOrdUTXO[];
  const hexes = await getHexes(ordUtxos);
  ordUtxos.forEach((f, i) => {
    f.rawHex = hexes[i];
  });

  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];
  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });

  const psbt = new Psbt({ network: networks.testnet });
  for (let i of ordUtxos) {
    if (
      psbt.txInputs.find((f) => f.hash.reverse().toString("hex") === i.txid) ===
      undefined
    )
      psbt.addInput({
        hash: i.txid,
        index: i.vout,
        nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
      });
  }

  for (let i of nonordUtxos) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }

  psbt.addOutput({
    address: wallet.address,
    value: 100000,
  });

  psbt.addOutput({
    address: wallet.address,
    value: 100000,
  });

  const fee = gptFeeCalculate(ordUtxos.length - 1 + nonordUtxos.length, 3, 100);
  console.log(`FEE: ${fee}`);

  psbt.addOutput({
    address: wallet.address,
    value: nonordUtxos.reduce((acc, val) => (acc += val.value), 0) - fee,
  });
  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

async function burn_inscription() {
  const wallet = wallets[0];
  let ordutxos = (
    (await (
      await fetch(`${ELECTRS_API}/address/${wallet.address}/ords`)
    ).json()) as ApiOrdUTXO[]
  ).splice(0, 2);
  // ordutxo.rawHex = (await getHexes([ordutxo]))[0];
  const hexes = await getHexes(ordutxos);
  ordutxos = ordutxos.map((f, i) => ({ ...f, rawHex: hexes[i] }));

  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];
  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });

  const psbt = new Psbt({ network: networks.testnet });

  const splicedNonOrd = nonordUtxos.splice(0, 2);

  for (const i of nonordUtxos) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }

  psbt.addInput({
    hash: ordutxos[0].txid,
    index: ordutxos[0].vout,
    nonWitnessUtxo: Buffer.from(ordutxos[0].rawHex!, "hex"),
  });

  psbt.addInput({
    hash: ordutxos[1].txid,
    index: ordutxos[1].vout,
    nonWitnessUtxo: Buffer.from(ordutxos[1].rawHex!, "hex"),
  });

  for (const i of splicedNonOrd) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }

  psbt.addOutput({
    address: wallet.address,
    value: nonordUtxos.reduce((acc, val) => (acc += val.value), 0) - 5000,
  });

  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

async function makeOneUtxo() {
  const wallet = wallets[0];
  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];
  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });
  const psbt = new Psbt({ network: networks.testnet });

  for (const i of nonordUtxos) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }
  psbt.addOutput({
    address: wallet.address,
    value:
      nonordUtxos.reduce((acc, val) => (acc += val.value), 0) -
      gptFeeCalculate(nonordUtxos.length, 1, 100),
  });
  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

async function make_a_lot_of_shit() {
  const wallet = wallets[wallets.length - 1];
  let ordutxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/ords`)
  ).json()) as ApiOrdUTXO[];
  // ordutxo.rawHex = (await getHexes([ordutxo]))[0];
  const hexes = await getHexes(ordutxos);
  ordutxos = ordutxos.map((f, i) => ({ ...f, rawHex: hexes[i] }));

  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];

  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });
  const psbt = new Psbt({ network: networks.testnet });

  const addedOrdUtxos = [];
  const addedRegularUtxos = [];

  for (const i of ordutxos) {
    if (
      psbt.txInputs.find(
        (f) => f.hash.reverse().toString("hex") === i.txid && f.index === i.vout
      ) === undefined
    ) {
      psbt.addInput({
        hash: i.txid,
        index: i.vout,
        nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
      });
      addedOrdUtxos.push(i);
    }
  }

  for (const i of nonordUtxos) {
    if (
      psbt.txInputs.find(
        (f) => f.hash.reverse().toString("hex") === i.txid && f.index === i.vout
      ) === undefined
    ) {
      psbt.addInput({
        hash: i.txid,
        index: i.vout,
        nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
      });
      addedRegularUtxos.push(i);
    }
  }

  for (const i of addedOrdUtxos) {
    psbt.addOutput({
      address: wallet.address,
      value: i.value + 10000,
    });
  }

  const change =
    addedOrdUtxos.reduce((acc, val) => (acc += val.value), 0) +
    addedRegularUtxos.reduce((acc, val) => (acc += val.value), 0) -
    addedOrdUtxos.reduce((acc, val) => (acc += val.value + 10000), 0) -
    gptFeeCalculate(
      addedOrdUtxos.length + addedRegularUtxos.length,
      addedOrdUtxos.length + 1,
      feeRate
    );

  psbt.addOutput({
    address: wallet.address,
    value: change,
  });

  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

async function send_all_ords_to_ieg() {
  const wallet = wallets[wallets.length - 1];
  let ordutxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/ords`)
  ).json()) as ApiOrdUTXO[];
  // ordutxo.rawHex = (await getHexes([ordutxo]))[0];
  const hexes = await getHexes(ordutxos);
  ordutxos = ordutxos.map((f, i) => ({ ...f, rawHex: hexes[i] }));

  const nonordUtxos = (await (
    await fetch(`${ELECTRS_API}/address/${wallet.address}/utxo`)
  ).json()) as ApiUTXO[];
  const nonhexes = await getHexes(nonordUtxos);
  nonordUtxos.forEach((f, i) => {
    f.rawHex = nonhexes[i];
  });
  const psbt = new Psbt({ network: networks.testnet });

  const addedOrdUtxos = [];

  for (const i of ordutxos) {
    if (
      psbt.txInputs.find((f) => f.hash.reverse().toString("hex") === i.txid) ===
      undefined
    ) {
      psbt.addInput({
        hash: i.txid,
        index: i.vout,
        nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
      });
      addedOrdUtxos.push(i);
    }
  }

  for (const i of nonordUtxos) {
    psbt.addInput({
      hash: i.txid,
      index: i.vout,
      nonWitnessUtxo: Buffer.from(i.rawHex!, "hex"),
    });
  }

  for (const i of addedOrdUtxos) {
    psbt.addOutput({
      address: "EMJCKGLb6qapq2kcgNHgcbkwmSYFkMvcVt",
      value: i.value,
    });
  }

  const change =
    nonordUtxos.reduce((acc, val) => (acc += val.value), 0) -
    gptFeeCalculate(
      addedOrdUtxos.length + nonordUtxos.length,
      addedOrdUtxos.length + 1,
      feeRate
    );

  psbt.addOutput({
    address: wallet.address,
    value: change,
  });

  const pair = ECPair.fromWIF(wallet.toJson().secret);
  psbt.signAllInputs(pair);
  psbt.finalizeAllInputs();
  console.log(psbt.extractTransaction(true).toHex());
}

const extractKey = (v: ApiOrdUTXO): string => {
  return `${v.txid}:${v.vout}:${v.offset}:${v.inscription_number}`;
};

async function calcOrdsSumForAddress() {
  const address = "B5DeDZs5K1BDfX842nFvgJftbyVYhnRC6z";

  let ords: ApiOrdUTXO[] = (await (
    await fetch(`${ELECTRS_API}/address/${address}/ords`)
  ).json()) as ApiOrdUTXO[];

  let chained_ords: ApiOrdUTXO[] = (await (
    await fetch(
      `${ELECTRS_API}/address/${address}/ords/chain/${extractKey(
        ords[ords.length - 1]
      )}`
    )
  ).json()) as ApiOrdUTXO[];

  console.log(
    `${ELECTRS_API}/address/${address}/ords/chain/${extractKey(
      chained_ords[chained_ords.length - 1]
    )}`
  );

  ords = ords
    .filter((x) => x.value > 100_000)
    .concat(chained_ords.filter((x) => x.value > 100_000));

  while (chained_ords.length >= 50) {
    let received_shit = (await (
      await fetch(
        `${ELECTRS_API}/address/${address}/ords/chain/${extractKey(
          chained_ords[chained_ords.length - 1]
        )}`
      )
    ).json()) as ApiOrdUTXO[];
    console.log(
      `${ELECTRS_API}/address/${address}/ords/chain/${extractKey(
        chained_ords[chained_ords.length - 1]
      )}`
    );
    ords = ords.concat(received_shit.filter((x) => x.value > 100_000));
    chained_ords = received_shit;
  }

  console.log(ords);
  console.log(`LENGTH - ${ords.length}`);
}

main().catch((e) => console.log(e));
