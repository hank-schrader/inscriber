export const PUBKEY_SIZE = 898;
export const PRIVKEY_SIZE = 1281;
export const MIN_ENTROPY: number = 128;
export const MAX_ENTROPY: number = 512;
export const ZERO_KEY = Buffer.allocUnsafe(PUBKEY_SIZE);
export const ZERO_PRIVKEY = Buffer.allocUnsafe(PRIVKEY_SIZE);
export const ELECTRS_API = "https://testnet.nintondo.io/electrs";
// export const ELECTRS_API = "https://electrs.nintondo.io/api";
export const MAIN_API = "https://api.nintondo.io/api";

export const UTXO_VALUE = 150000;
