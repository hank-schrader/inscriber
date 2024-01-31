import { UnspentOutput } from "bel-ord-utils/lib/OrdTransaction";
import { Psbt } from "belcoinjs-lib";

export interface IWallet {
  address: string;
  secret: string;
  utxos: ApiUTXO[];
  balance: number;
  fundWallet?: boolean;
  photoPath?: string;
}

export interface AccountBalanceResponse {
  address: string;
  chain_stats: ChainStats;
  mempool_stats: MempoolStats;
}

export interface ChainStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}
export interface MempoolStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface ApiUTXO {
  txid: string;
  vout: number;
  status: Status;
  value: number;
  scriptPubKeyHex?: string;
  redeemScriptHex?: string;
}

export interface Status {
  confirmed: boolean;
  block_height: number;
  block_hash: string;
  block_time: number;
}

export interface SerializedSimpleKey extends SerializedBase {
  privateKey: string;
  isHex?: boolean;
  utxos?: ApiUTXO[];
  balance?: number;
  address?: string;
  fundWallet?: boolean;
  photoPath?: string;
}

interface SerializedBase {
  addressType: AddressType;
}

export declare enum AddressType {
  P2PKH = 0,
  P2WPKH = 1,
  P2TR = 2,
  P2SH_P2WPKH = 3,
  M44_P2WPKH = 4,
  M44_P2TR = 5,
}

export interface RawTx {
  txid: string;
  version: number;
  locktime: number;
  vin: Vin[];
  vout: Vout[];
  size: number;
  weight: number;
  sigops: number;
  fee: number;
  status: Status;
}

export interface Vin {
  txid: string;
  vout: number;
  prevout: Prevout;
  scriptsig: string;
  scriptsig_asm: string;
  is_coinbase: boolean;
  sequence: number;
}

export interface Prevout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number;
}

export interface Vout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address: string;
  value: number;
}

export interface Status {
  confirmed: boolean;
  block_height: number;
  block_hash: string;
  block_time: number;
}

export interface ICalculateFeeForPsbtWithManyOutputs {
  psbt: Psbt;
  outputAmount: number;
  feeRate: number;
  address: string;
  pair: any;
}
