import {
  AccountBalanceResponse,
  ApiUTXO,
  IWallet,
  SerializedSimpleKey,
} from "./types";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { ECPairInterface } from "belpair";
import { networks, Psbt } from "belcoinjs-lib";
import { sha256 } from "@noble/hashes/sha256";
import { BaseWallet } from "bellhdw/src/hd/base";
import ECPair from "./ecpair";
import { AddressType, Keyring } from "bellhdw";
import { ZERO_PRIVKEY, ZERO_KEY, ELECTRS_API } from "./consts";
import { ToSignInput } from "bellhdw/src/hd/types";
import { calculateFeeForPsbtWithManyOutputs, getHexes } from "./utils";

class Wallet extends BaseWallet implements Keyring<SerializedSimpleKey> {
  privateKey: Uint8Array = ZERO_PRIVKEY;
  publicKey = ZERO_KEY;

  utxos: ApiUTXO[] = [];
  balance: number = 0;
  address: string = "";
  fundWallet: boolean = false;
  photoPath?: string;

  private pair?: ECPairInterface;

  constructor(
    privateKey: Uint8Array,
    utxos?: ApiUTXO[],
    balance?: number,
    address?: string,
    fundWallet?: boolean,
    photoPath?: string
  ) {
    super();
    this.privateKey = privateKey;
    this.utxos = utxos ?? [];
    this.balance = balance ?? 0;
    this.address = address ?? "";
    this.fundWallet = fundWallet ?? false;
    this.photoPath = photoPath;
    this.network = networks.testnet;
  }

  private initPair() {
    if (!this.privateKey)
      throw new Error("Simple Keyring: Invalid privateKey provided");
    if (!this.pair) {
      this.pair = ECPair.fromPrivateKey(Buffer.from(this.privateKey));
      this.publicKey = this.pair.publicKey;
    }
  }

  signTypedData(address: string, typedData: Record<string, unknown>) {
    this.initPair();

    return this.signMessage(address, JSON.stringify(typedData));
  }

  verifyMessage(_address: string, text: string, sig: string) {
    this.initPair();

    return this.pair!.verify(
      Buffer.from(hexToBytes(text)),
      Buffer.from(hexToBytes(sig))
    )!;
  }

  getAccounts() {
    this.initPair();

    return [this.getAddress(this.publicKey)!];
  }

  serialize() {
    this.initPair();

    const wif = this.pair?.toWIF();
    if (!wif) throw new Error("Failed to export wif for simple wallet");

    return {
      privateKey: wif,
      addressType: this.addressType!,
    };
  }

  deserialize(state: SerializedSimpleKey) {
    const wallet = Wallet.deserialize(state);
    this.privateKey = wallet.privateKey;
    this.pair = wallet.pair;
    this.addressType = wallet.addressType;
    return this;
  }

  signAllInputsInPsbt(
    psbt: Psbt,
    accountAddress: string
  ): { signatures: (string | undefined)[] } {
    psbt.signAllInputs(this.pair!);
    return { signatures: [] };
  }

  signInputsWithoutFinalizing(
    psbt: Psbt,
    inputs: ToSignInput[]
  ): {
    inputIndex: number;
    partialSig: { pubkey: Buffer; signature: Buffer }[];
  }[] {
    return [];
  }

  static deserialize(state: SerializedSimpleKey) {
    let pair: ECPairInterface | undefined;

    if (state.isHex) {
      pair = ECPair.fromPrivateKey(Buffer.from(state.privateKey, "hex"));
    } else {
      pair = ECPair.fromWIF(state.privateKey);
    }

    const wallet = new this(
      pair.privateKey!,
      state.utxos,
      state.balance,
      state.address,
      state.fundWallet,
      state.photoPath
    );
    wallet.initPair();
    wallet.addressType = state.addressType;
    return wallet;
  }

  exportAccount(
    _address: string,
    _options?: Record<string, unknown> | undefined
  ) {
    this.initPair();

    return this.pair!.toWIF();
  }

  exportPublicKey(_address: string) {
    this.initPair();

    return bytesToHex(this.publicKey);
  }

  signPsbt(psbt: Psbt, inputs: ToSignInput[]) {
    this.initPair();

    for (let i of inputs) {
      psbt.signInput(i.index, this.pair!, i.sighashTypes);
    }
    psbt.finalizeAllInputs();
  }

  signMessage(_address: string, message: string) {
    this.initPair();

    const encoded = sha256(message);
    return bytesToHex(this.pair!.sign(Buffer.from(encoded)));
  }

  signPersonalMessage(address: string, message: string) {
    return this.signMessage(address, message);
  }

  toJson(): IWallet {
    return {
      address: this.getAddress(this.publicKey) ?? "",
      secret: this.exportAccount(this.getAddress(this.publicKey) ?? ""),
      balance: this.balance,
      utxos: this.utxos,
      fundWallet: this.fundWallet,
      photoPath: this.photoPath,
    };
  }

  async splitUtxos(feeRate: number, count: number = 2) {
    if (!this.utxos.length) return;
    const hexes = await getHexes(this.utxos);
    const psbt = new Psbt({ network: networks.bellcoin });
    psbt.setVersion(1);
    let availabelAmount = 0;
    for (let i = 0; i < this.utxos.length; i++) {
      psbt.addInput({
        hash: this.utxos[i].txid,
        index: this.utxos[i].vout,
        nonWitnessUtxo: Buffer.from(hexes[i], "hex"),
      });
      availabelAmount += this.utxos[i].value;
    }
    availabelAmount -= calculateFeeForPsbtWithManyOutputs({
      psbt: psbt.clone(),
      outputAmount: count,
      feeRate,
      address: this.getAddress(this.publicKey)!,
      pair: this.pair!,
    });

    for (let i = 0; i < count; i++) {
      psbt.addOutput({
        address: this.getAddress(this.publicKey)!,
        value: Math.floor(availabelAmount / count),
      });
    }

    psbt.signAllInputs(this.pair!);
    psbt.finalizeAllInputs();
    return psbt.extractTransaction(true).toHex();
  }

  async sync() {
    const response = (await (
      await fetch(`${ELECTRS_API}/address/${this.address}/utxo`, {
        method: "GET",
      })
    ).json()) as unknown as ApiUTXO[];
    if (!response) {
      this.balance = 0;
      this.utxos = [];
      return;
    }

    this.balance = response.reduce((acc, v) => (acc += v.value), 0);

    if (this.balance) {
      this.utxos = (await (
        await fetch(`${ELECTRS_API}/address/${this.address}/utxo`, {
          method: "GET",
        })
      ).json()) as unknown as ApiUTXO[];
    }
  }
}

export default Wallet;
